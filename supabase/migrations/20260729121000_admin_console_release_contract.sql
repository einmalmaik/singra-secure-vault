-- Complete the Premium admin-console backend with deny-by-default storage,
-- typed service-role RPCs and adaptive danger-action approval.

INSERT INTO public.team_permissions (permission_key, label, description, category)
VALUES
  ('admin.settings.manage', 'Manage Global Settings', 'Change constrained non-secret platform policies.', 'admin'),
  ('admin.notifications.manage', 'Manage Admin Notifications', 'Mark and acknowledge administrative notifications.', 'admin'),
  ('admin.danger.read', 'Read Danger Requests', 'View constrained danger-action request state.', 'admin'),
  ('admin.danger.manage', 'Manage Danger Requests', 'Request, approve, cancel and execute sensitive administrative actions.', 'admin'),
  ('admin.audit.export', 'Export Admin Audit', 'Export constrained administrative audit events.', 'admin'),
  ('team.users.manage', 'Manage User Lifecycle', 'Suspend accounts and revoke account sessions.', 'admin')
ON CONFLICT (permission_key) DO UPDATE
SET label = EXCLUDED.label,
    description = EXCLUDED.description,
    category = EXCLUDED.category;

INSERT INTO public.role_permissions (role, permission_key)
SELECT 'admin', permission_key
FROM (VALUES
  ('admin.settings.manage'),
  ('admin.notifications.manage'),
  ('admin.danger.read'),
  ('admin.danger.manage'),
  ('admin.audit.export'),
  ('team.users.manage')
) AS permissions(permission_key)
ON CONFLICT (role, permission_key) DO NOTHING;

ALTER TABLE public.team_roles
  ADD COLUMN IF NOT EXISTS priority INTEGER NOT NULL DEFAULT 100
    CHECK (priority BETWEEN 0 AND 1000),
  ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'global'
    CHECK (scope IN ('global', 'support', 'billing', 'security', 'read_only'));

UPDATE public.team_roles
SET priority = CASE role_name WHEN 'admin' THEN 1000 WHEN 'moderator' THEN 500 ELSE priority END,
    scope = CASE role_name WHEN 'admin' THEN 'global' WHEN 'moderator' THEN 'support' ELSE scope END
WHERE role_name IN ('admin', 'moderator');

CREATE TABLE IF NOT EXISTS public.user_permission_overrides (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  permission_key TEXT NOT NULL REFERENCES public.team_permissions(permission_key) ON DELETE CASCADE,
  effect TEXT NOT NULL CHECK (effect IN ('allow', 'deny')),
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
  PRIMARY KEY (user_id, permission_key)
);

ALTER TABLE public.user_permission_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_permission_overrides FORCE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.user_permission_overrides
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_permission_overrides TO service_role;

CREATE OR REPLACE FUNCTION public.has_permission(_user_id UUID, _permission_key TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN override.effect = 'deny' THEN FALSE
    WHEN override.effect = 'allow' THEN TRUE
    ELSE EXISTS (
      SELECT 1
      FROM public.user_roles AS assigned
      JOIN public.role_permissions AS granted ON granted.role = assigned.role
      WHERE assigned.user_id = _user_id
        AND granted.permission_key = _permission_key
    )
  END
  FROM (SELECT 1) AS singleton
  LEFT JOIN public.user_permission_overrides AS override
    ON override.user_id = _user_id
   AND override.permission_key = _permission_key;
$$;

CREATE OR REPLACE FUNCTION public.get_my_permissions()
RETURNS TABLE(permission_key TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH candidates AS (
    SELECT granted.permission_key
    FROM public.user_roles AS assigned
    JOIN public.role_permissions AS granted ON granted.role = assigned.role
    WHERE assigned.user_id = auth.uid()
    UNION
    SELECT override.permission_key
    FROM public.user_permission_overrides AS override
    WHERE override.user_id = auth.uid() AND override.effect = 'allow'
  )
  SELECT candidates.permission_key
  FROM candidates
  WHERE public.has_permission(auth.uid(), candidates.permission_key);
$$;

CREATE OR REPLACE FUNCTION public.admin_set_user_permission_override(
  _actor_user_id UUID,
  _target_user_id UUID,
  _permission_key TEXT,
  _effect TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('admin_user_permission_override', 0));
  IF NOT public.has_permission(_actor_user_id, 'team.permissions.manage') THEN
    RAISE EXCEPTION 'insufficient_permissions' USING ERRCODE = '42501';
  END IF;
  IF _actor_user_id = _target_user_id THEN
    RAISE EXCEPTION 'self_permission_override_forbidden' USING ERRCODE = '42501';
  END IF;
  IF _effect NOT IN ('inherit', 'allow', 'deny')
    OR NOT EXISTS (SELECT 1 FROM public.team_permissions WHERE permission_key = _permission_key)
    OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = _target_user_id)
  THEN
    RAISE EXCEPTION 'invalid_permission_override' USING ERRCODE = '22023';
  END IF;
  IF _permission_key IN (
    'team.roles.manage', 'team.permissions.manage', 'admin.danger.manage'
  ) AND EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _target_user_id AND role = 'admin'
  ) AND _effect = 'deny' THEN
    RAISE EXCEPTION 'protected_admin_permission' USING ERRCODE = '42501';
  END IF;
  IF _effect = 'inherit' THEN
    DELETE FROM public.user_permission_overrides
    WHERE user_id = _target_user_id AND permission_key = _permission_key;
  ELSE
    INSERT INTO public.user_permission_overrides (
      user_id, permission_key, effect, updated_by, updated_at
    ) VALUES (
      _target_user_id, _permission_key, _effect, _actor_user_id, pg_catalog.now()
    )
    ON CONFLICT (user_id, permission_key) DO UPDATE
      SET effect = EXCLUDED.effect,
          updated_by = EXCLUDED.updated_by,
          updated_at = EXCLUDED.updated_at;
  END IF;
  PERFORM public.append_admin_audit_event(
    pg_catalog.gen_random_uuid(), _actor_user_id, _target_user_id,
    'team.permission.changed', 'succeeded', 'USER_OVERRIDE_CHANGED', NULL
  );
  RETURN _effect;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_user_permission_override(UUID, UUID, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_user_permission_override(UUID, UUID, TEXT, TEXT)
  TO service_role;

CREATE OR REPLACE FUNCTION public.admin_create_role_v2(
  _actor_user_id UUID,
  _role_name TEXT,
  _description TEXT,
  _priority INTEGER,
  _scope TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.has_permission(_actor_user_id, 'team.roles.manage') THEN
    RAISE EXCEPTION 'insufficient_permissions' USING ERRCODE = '42501';
  END IF;
  IF _role_name IS NULL OR _role_name !~ '^[a-z][a-z0-9_]{1,31}$'
    OR pg_catalog.length(COALESCE(_description, '')) > 240
    OR _priority NOT BETWEEN 0 AND 999
    OR _scope NOT IN ('global', 'support', 'billing', 'security', 'read_only')
  THEN
    RAISE EXCEPTION 'invalid_role' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.team_roles (
    role_name, description, is_system, priority, scope
  ) VALUES (
    _role_name, NULLIF(_description, ''), FALSE, _priority, _scope
  );
  PERFORM public.append_admin_audit_event(
    pg_catalog.gen_random_uuid(), _actor_user_id, NULL,
    'team.role.changed', 'succeeded', 'ROLE_CREATED', NULL
  );
  RETURN TRUE;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_create_role_v2(UUID, TEXT, TEXT, INTEGER, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_create_role_v2(UUID, TEXT, TEXT, INTEGER, TEXT)
  TO service_role;

CREATE OR REPLACE FUNCTION public.admin_revoke_user_sessions(
  _actor_user_id UUID,
  _target_user_id UUID
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE removed_sessions BIGINT;
BEGIN
  IF NOT public.has_permission(_actor_user_id, 'team.users.manage') THEN
    RAISE EXCEPTION 'insufficient_permissions' USING ERRCODE = '42501';
  END IF;
  IF _target_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM auth.users WHERE id = _target_user_id
  ) THEN
    RAISE EXCEPTION 'target_user_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT pg_catalog.count(*) INTO removed_sessions
  FROM auth.sessions WHERE user_id = _target_user_id;
  PERFORM public.revoke_user_auth_sessions(_target_user_id);
  PERFORM public.append_admin_audit_event(
    pg_catalog.gen_random_uuid(), _actor_user_id, _target_user_id,
    'user.lifecycle.changed', 'succeeded', 'SESSIONS_REVOKED', NULL
  );
  RETURN removed_sessions;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_revoke_user_sessions(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_revoke_user_sessions(UUID, UUID)
  TO service_role;

-- The support-widget migration owns support_widget_enabled/support_widget_id.
ALTER TABLE public.admin_platform_settings
  ADD COLUMN IF NOT EXISTS attachment_limit_bytes BIGINT NOT NULL DEFAULT 26214400
    CHECK (attachment_limit_bytes BETWEEN 1048576 AND 1073741824),
  ADD COLUMN IF NOT EXISTS notification_retention_days INTEGER NOT NULL DEFAULT 90
    CHECK (notification_retention_days BETWEEN 7 AND 3650),
  ADD COLUMN IF NOT EXISTS maintenance_mode BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS public.admin_mutation_idempotency (
  idempotency_key UUID PRIMARY KEY,
  actor_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  operation TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
  CHECK (operation ~ '^[a-z_]{3,64}$'),
  CHECK (fingerprint ~ '^[A-Za-z0-9_|.:-]{1,512}$')
);
ALTER TABLE public.admin_mutation_idempotency ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_mutation_idempotency FORCE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.admin_mutation_idempotency
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.admin_mutation_idempotency TO service_role;

CREATE OR REPLACE FUNCTION public.set_admin_global_settings(
  _registration_mode TEXT,
  _support_widget_enabled BOOLEAN,
  _support_widget_id TEXT,
  _attachment_limit_bytes BIGINT,
  _notification_retention_days INTEGER,
  _maintenance_mode BOOLEAN,
  _expected_updated_at TIMESTAMPTZ,
  _idempotency_key UUID,
  _reauth_proof_id UUID
)
RETURNS TABLE (
  registration_mode TEXT,
  support_widget_enabled BOOLEAN,
  support_widget_id TEXT,
  attachment_limit_bytes BIGINT,
  notification_retention_days INTEGER,
  maintenance_mode BOOLEAN,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor_user_id UUID := auth.uid();
  request_fingerprint TEXT;
  stored_fingerprint TEXT;
BEGIN
  IF actor_user_id IS NULL OR NOT public.has_permission(actor_user_id, 'admin.settings.manage') THEN
    RAISE EXCEPTION 'insufficient_permissions' USING ERRCODE = '42501';
  END IF;
  IF _idempotency_key IS NULL OR _expected_updated_at IS NULL
    OR _registration_mode NOT IN ('open', 'closed')
    OR _support_widget_enabled IS NULL
    OR (_support_widget_enabled AND (_support_widget_id IS NULL OR _support_widget_id !~ '^[A-Za-z0-9_-]{1,128}$'))
    OR (_support_widget_id IS NOT NULL AND _support_widget_id !~ '^[A-Za-z0-9_-]{1,128}$')
    OR _attachment_limit_bytes IS NULL
    OR _attachment_limit_bytes NOT BETWEEN 1048576 AND 1073741824
    OR _notification_retention_days IS NULL
    OR _notification_retention_days NOT BETWEEN 7 AND 3650
    OR _maintenance_mode IS NULL
  THEN
    RAISE EXCEPTION 'invalid_admin_settings' USING ERRCODE = '22023';
  END IF;

  request_fingerprint := pg_catalog.concat_ws(
    '|', _registration_mode, _support_widget_enabled::TEXT,
    COALESCE(_support_widget_id, '-'), _attachment_limit_bytes::TEXT,
    _notification_retention_days::TEXT, _maintenance_mode::TEXT
  );
  SELECT entry.fingerprint INTO stored_fingerprint
  FROM public.admin_mutation_idempotency AS entry
  WHERE entry.idempotency_key = _idempotency_key
    AND entry.actor_user_id = actor_user_id
    AND entry.operation = 'set_admin_global_settings';

  IF stored_fingerprint IS NOT NULL AND stored_fingerprint <> request_fingerprint THEN
    RAISE EXCEPTION 'idempotency_key_reused' USING ERRCODE = '22023';
  END IF;
  IF stored_fingerprint IS NULL THEN
    PERFORM public.consume_reauth_proof(_reauth_proof_id);
    INSERT INTO public.admin_mutation_idempotency (
      idempotency_key, actor_user_id, operation, fingerprint
    ) VALUES (
      _idempotency_key, actor_user_id, 'set_admin_global_settings', request_fingerprint
    );
    UPDATE public.admin_platform_settings AS settings
    SET registration_mode = _registration_mode,
        support_widget_enabled = _support_widget_enabled,
        support_widget_id = CASE WHEN _support_widget_enabled THEN _support_widget_id ELSE NULL END,
        attachment_limit_bytes = _attachment_limit_bytes,
        notification_retention_days = _notification_retention_days,
        maintenance_mode = _maintenance_mode,
        updated_at = pg_catalog.now()
    WHERE settings.singleton = TRUE
      AND settings.updated_at = _expected_updated_at;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'admin_settings_conflict' USING ERRCODE = '40001';
    END IF;
    PERFORM public.append_admin_audit_event(
      pg_catalog.gen_random_uuid(), actor_user_id, NULL,
      'security.rule.changed', 'succeeded', 'GLOBAL_SETTINGS_CHANGED', NULL
    );
  END IF;

  RETURN QUERY SELECT
    settings.registration_mode,
    settings.support_widget_enabled,
    settings.support_widget_id,
    settings.attachment_limit_bytes,
    settings.notification_retention_days,
    settings.maintenance_mode,
    settings.updated_at
  FROM public.admin_platform_settings AS settings
  WHERE settings.singleton = TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.set_admin_global_settings(
  TEXT, BOOLEAN, TEXT, BIGINT, INTEGER, BOOLEAN, TIMESTAMPTZ, UUID, UUID
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_admin_global_settings(
  TEXT, BOOLEAN, TEXT, BIGINT, INTEGER, BOOLEAN, TIMESTAMPTZ, UUID, UUID
) TO authenticated;

DROP FUNCTION IF EXISTS public.get_admin_global_settings(UUID);
CREATE FUNCTION public.get_admin_global_settings(_actor_user_id UUID)
RETURNS TABLE (
  registration_mode TEXT,
  support_widget_enabled BOOLEAN,
  support_widget_id TEXT,
  attachment_limit_bytes BIGINT,
  notification_retention_days INTEGER,
  maintenance_mode BOOLEAN,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.has_permission(_actor_user_id, 'admin.settings.read') THEN
    RAISE EXCEPTION 'insufficient_permissions' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT
    settings.registration_mode,
    settings.support_widget_enabled,
    settings.support_widget_id,
    settings.attachment_limit_bytes,
    settings.notification_retention_days,
    settings.maintenance_mode,
    settings.updated_at
  FROM public.admin_platform_settings AS settings
  WHERE settings.singleton = TRUE;
END;
$$;
REVOKE ALL ON FUNCTION public.get_admin_global_settings(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_global_settings(UUID) TO service_role;

CREATE TABLE IF NOT EXISTS public.admin_notifications (
  id UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  event_type TEXT NOT NULL CHECK (event_type IN (
    'security_alert', 'system_degraded', 'danger_action', 'settings_changed', 'user_lifecycle'
  )),
  priority TEXT NOT NULL CHECK (priority IN ('info', 'warning', 'critical')),
  title_code TEXT NOT NULL CHECK (title_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  detail_code TEXT CHECK (detail_code IS NULL OR detail_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  dedupe_key TEXT NOT NULL UNIQUE CHECK (dedupe_key ~ '^[A-Za-z0-9_.:-]{1,128}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now()
);
CREATE TABLE IF NOT EXISTS public.admin_notification_receipts (
  notification_id UUID NOT NULL REFERENCES public.admin_notifications(id) ON DELETE CASCADE,
  admin_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  read_at TIMESTAMPTZ,
  acknowledged_at TIMESTAMPTZ,
  PRIMARY KEY (notification_id, admin_user_id),
  CHECK (acknowledged_at IS NULL OR read_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS admin_notifications_created_idx
  ON public.admin_notifications (created_at DESC, id DESC);
ALTER TABLE public.admin_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_notifications FORCE ROW LEVEL SECURITY;
ALTER TABLE public.admin_notification_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_notification_receipts FORCE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.admin_notifications, public.admin_notification_receipts
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.admin_notifications TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.admin_notification_receipts TO service_role;

CREATE OR REPLACE FUNCTION public.list_admin_notifications(
  _actor_user_id UUID,
  _limit INTEGER DEFAULT 50,
  _cursor_created_at TIMESTAMPTZ DEFAULT NULL,
  _cursor_id UUID DEFAULT NULL
)
RETURNS TABLE (
  id UUID, event_type TEXT, priority TEXT, title_code TEXT, detail_code TEXT,
  created_at TIMESTAMPTZ, read_at TIMESTAMPTZ, acknowledged_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.has_permission(_actor_user_id, 'admin.notifications.read')
    OR _limit NOT BETWEEN 1 AND 100
    OR ((_cursor_created_at IS NULL) <> (_cursor_id IS NULL))
  THEN
    RAISE EXCEPTION 'invalid_or_unauthorized_notification_query' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT
    notification.id, notification.event_type, notification.priority,
    notification.title_code, notification.detail_code, notification.created_at,
    receipt.read_at, receipt.acknowledged_at
  FROM public.admin_notifications AS notification
  LEFT JOIN public.admin_notification_receipts AS receipt
    ON receipt.notification_id = notification.id
   AND receipt.admin_user_id = _actor_user_id
  WHERE (
      _cursor_created_at IS NULL
      OR (notification.created_at, notification.id) < (_cursor_created_at, _cursor_id)
    )
    AND notification.created_at >= pg_catalog.now() - (
      SELECT pg_catalog.make_interval(days => settings.notification_retention_days)
      FROM public.admin_platform_settings AS settings WHERE settings.singleton = TRUE
    )
  ORDER BY notification.created_at DESC, notification.id DESC
  LIMIT _limit;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_admin_notification_receipt(
  _actor_user_id UUID,
  _notification_id UUID,
  _acknowledge BOOLEAN
)
RETURNS TABLE (
  id UUID, event_type TEXT, priority TEXT, title_code TEXT, detail_code TEXT,
  created_at TIMESTAMPTZ, read_at TIMESTAMPTZ, acknowledged_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.has_permission(_actor_user_id, 'admin.notifications.manage')
    OR _notification_id IS NULL OR _acknowledge IS NULL
  THEN
    RAISE EXCEPTION 'invalid_or_unauthorized_notification_mutation' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.admin_notifications WHERE id = _notification_id) THEN
    RAISE EXCEPTION 'notification_not_found' USING ERRCODE = 'P0002';
  END IF;
  INSERT INTO public.admin_notification_receipts (
    notification_id, admin_user_id, read_at, acknowledged_at
  ) VALUES (
    _notification_id, _actor_user_id, pg_catalog.now(),
    CASE WHEN _acknowledge THEN pg_catalog.now() ELSE NULL END
  )
  ON CONFLICT (notification_id, admin_user_id) DO UPDATE
    SET read_at = COALESCE(public.admin_notification_receipts.read_at, pg_catalog.now()),
        acknowledged_at = CASE WHEN _acknowledge
          THEN COALESCE(public.admin_notification_receipts.acknowledged_at, pg_catalog.now())
          ELSE public.admin_notification_receipts.acknowledged_at END;
  RETURN QUERY SELECT
    notification.id, notification.event_type, notification.priority,
    notification.title_code, notification.detail_code, notification.created_at,
    receipt.read_at, receipt.acknowledged_at
  FROM public.admin_notifications AS notification
  JOIN public.admin_notification_receipts AS receipt
    ON receipt.notification_id = notification.id
   AND receipt.admin_user_id = _actor_user_id
  WHERE notification.id = _notification_id;
END;
$$;

REVOKE ALL ON FUNCTION public.list_admin_notifications(UUID, INTEGER, TIMESTAMPTZ, UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_admin_notification_receipt(UUID, UUID, BOOLEAN)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_admin_notifications(UUID, INTEGER, TIMESTAMPTZ, UUID)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.set_admin_notification_receipt(UUID, UUID, BOOLEAN)
  TO service_role;

-- Upgrade danger requests without deleting historical rows.
ALTER TABLE public.danger_action_requests
  DROP CONSTRAINT IF EXISTS danger_action_requests_status_check;
UPDATE public.danger_action_requests SET status = 'cancelled' WHERE status = 'rejected';
ALTER TABLE public.danger_action_requests
  ADD COLUMN IF NOT EXISTS approval_mode TEXT NOT NULL DEFAULT 'four_eyes'
    CHECK (approval_mode IN ('single_admin_delay', 'four_eyes')),
  ADD COLUMN IF NOT EXISTS execute_after TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS idempotency_key UUID,
  ADD COLUMN IF NOT EXISTS failure_code TEXT
    CHECK (failure_code IS NULL OR failure_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  ADD CONSTRAINT danger_action_requests_status_check CHECK (
    status IN ('pending', 'scheduled', 'approved', 'cancelled', 'expired', 'executed', 'failed')
  );
UPDATE public.danger_action_requests
SET expires_at = COALESCE(expires_at, created_at + INTERVAL '30 minutes');
ALTER TABLE public.danger_action_requests ALTER COLUMN expires_at SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS danger_action_requests_idempotency_idx
  ON public.danger_action_requests (requested_by, idempotency_key);
REVOKE ALL PRIVILEGES ON TABLE public.danger_action_requests
  FROM PUBLIC, anon, authenticated;
DROP POLICY IF EXISTS "Admins can select danger requests" ON public.danger_action_requests;
DROP POLICY IF EXISTS "Admins can insert danger requests" ON public.danger_action_requests;
GRANT SELECT, INSERT, UPDATE ON TABLE public.danger_action_requests TO service_role;
REVOKE ALL ON FUNCTION public.request_danger_action(UUID, TEXT)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.approve_danger_action(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.reject_danger_action(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_admin_danger_policy(_actor_user_id UUID)
RETURNS TABLE (
  admin_count BIGINT,
  approval_mode TEXT,
  cancellation_window_seconds INTEGER,
  approval_window_seconds INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE current_admin_count BIGINT;
BEGIN
  IF NOT public.has_permission(_actor_user_id, 'admin.danger.read') THEN
    RAISE EXCEPTION 'insufficient_permissions' USING ERRCODE = '42501';
  END IF;
  SELECT pg_catalog.count(*) INTO current_admin_count
  FROM public.user_roles WHERE role = 'admin';
  RETURN QUERY SELECT
    current_admin_count,
    CASE WHEN current_admin_count <= 1 THEN 'single_admin_delay' ELSE 'four_eyes' END,
    600,
    1800;
END;
$$;

CREATE OR REPLACE FUNCTION public.request_admin_danger_action(
  _action_type TEXT,
  _confirmation_phrase TEXT,
  _reauth_proof_id UUID,
  _idempotency_key UUID
)
RETURNS TABLE (
  id UUID, action_type TEXT, status TEXT, approval_mode TEXT,
  execute_after TIMESTAMPTZ, expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor_user_id UUID := auth.uid();
  current_admin_count BIGINT;
  expected_phrase TEXT;
  created_request public.danger_action_requests%ROWTYPE;
BEGIN
  IF actor_user_id IS NULL OR NOT public.has_permission(actor_user_id, 'admin.danger.manage') THEN
    RAISE EXCEPTION 'insufficient_permissions' USING ERRCODE = '42501';
  END IF;
  expected_phrase := CASE _action_type
    WHEN 'activate_emergency_mode' THEN 'EMERGENCY'
    WHEN 'close_all_sessions' THEN 'CLOSE ALL SESSIONS'
    ELSE NULL
  END;
  IF expected_phrase IS NULL OR _confirmation_phrase <> expected_phrase OR _idempotency_key IS NULL THEN
    RAISE EXCEPTION 'invalid_danger_action_request' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('admin_danger_action', 0));
  SELECT * INTO created_request
  FROM public.danger_action_requests
  WHERE requested_by = actor_user_id AND idempotency_key = _idempotency_key;
  IF created_request.id IS NULL THEN
    PERFORM public.consume_reauth_proof(_reauth_proof_id);
    SELECT pg_catalog.count(*) INTO current_admin_count
    FROM public.user_roles WHERE role = 'admin';
    INSERT INTO public.danger_action_requests (
      action_type, requested_by, status, approval_mode,
      execute_after, expires_at, idempotency_key
    ) VALUES (
      _action_type, actor_user_id,
      CASE WHEN current_admin_count <= 1 THEN 'scheduled' ELSE 'pending' END,
      CASE WHEN current_admin_count <= 1 THEN 'single_admin_delay' ELSE 'four_eyes' END,
      CASE WHEN current_admin_count <= 1 THEN pg_catalog.now() + INTERVAL '10 minutes' ELSE NULL END,
      pg_catalog.now() + CASE WHEN current_admin_count <= 1 THEN INTERVAL '20 minutes' ELSE INTERVAL '30 minutes' END,
      _idempotency_key
    ) RETURNING * INTO created_request;
    PERFORM public.append_admin_audit_event(
      pg_catalog.gen_random_uuid(), actor_user_id, NULL,
      'user.lifecycle.changed', 'started', 'DANGER_ACTION_REQUESTED', NULL
    );
  ELSIF created_request.action_type <> _action_type THEN
    RAISE EXCEPTION 'idempotency_key_reused' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY SELECT
    created_request.id, created_request.action_type, created_request.status,
    created_request.approval_mode, created_request.execute_after,
    created_request.expires_at, created_request.created_at, created_request.updated_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_admin_danger_action(
  _request_id UUID,
  _reauth_proof_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE actor_user_id UUID := auth.uid(); request_row public.danger_action_requests%ROWTYPE;
BEGIN
  IF actor_user_id IS NULL OR NOT public.has_permission(actor_user_id, 'admin.danger.manage') THEN
    RAISE EXCEPTION 'insufficient_permissions' USING ERRCODE = '42501';
  END IF;
  PERFORM public.consume_reauth_proof(_reauth_proof_id);
  SELECT * INTO request_row FROM public.danger_action_requests
  WHERE id = _request_id FOR UPDATE;
  IF request_row.id IS NULL OR request_row.status <> 'pending'
    OR request_row.approval_mode <> 'four_eyes' THEN
    RAISE EXCEPTION 'danger_request_not_pending' USING ERRCODE = '22023';
  END IF;
  IF request_row.requested_by = actor_user_id THEN
    RAISE EXCEPTION 'self_approval_forbidden' USING ERRCODE = '42501';
  END IF;
  IF request_row.expires_at <= pg_catalog.now() THEN
    UPDATE public.danger_action_requests SET status = 'expired', updated_at = pg_catalog.now()
    WHERE id = _request_id;
    RAISE EXCEPTION 'danger_request_expired' USING ERRCODE = '22023';
  END IF;
  UPDATE public.danger_action_requests
  SET status = 'approved', approved_by = actor_user_id,
      execute_after = pg_catalog.now(), updated_at = pg_catalog.now()
  WHERE id = _request_id;
  PERFORM public.append_admin_audit_event(
    pg_catalog.gen_random_uuid(), actor_user_id, NULL,
    'user.lifecycle.changed', 'succeeded', 'DANGER_ACTION_APPROVED', NULL
  );
  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_admin_danger_action(
  _actor_user_id UUID, _request_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.has_permission(_actor_user_id, 'admin.danger.manage') THEN
    RAISE EXCEPTION 'insufficient_permissions' USING ERRCODE = '42501';
  END IF;
  UPDATE public.danger_action_requests
  SET status = 'cancelled', updated_at = pg_catalog.now()
  WHERE id = _request_id
    AND requested_by = _actor_user_id
    AND status IN ('pending', 'scheduled');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'danger_request_not_cancellable' USING ERRCODE = '22023';
  END IF;
  PERFORM public.append_admin_audit_event(
    pg_catalog.gen_random_uuid(), _actor_user_id, NULL,
    'user.lifecycle.changed', 'denied', 'DANGER_ACTION_CANCELLED', NULL
  );
  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.execute_admin_danger_action(
  _actor_user_id UUID, _request_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE request_row public.danger_action_requests%ROWTYPE;
BEGIN
  IF NOT public.has_permission(_actor_user_id, 'admin.danger.manage') THEN
    RAISE EXCEPTION 'insufficient_permissions' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO request_row FROM public.danger_action_requests WHERE id = _request_id FOR UPDATE;
  IF request_row.id IS NULL
    OR request_row.status NOT IN ('scheduled', 'approved')
    OR request_row.execute_after IS NULL
    OR request_row.execute_after > pg_catalog.now()
  THEN
    RAISE EXCEPTION 'danger_request_not_executable' USING ERRCODE = '22023';
  END IF;
  IF request_row.expires_at <= pg_catalog.now() THEN
    UPDATE public.danger_action_requests SET status = 'expired', updated_at = pg_catalog.now()
    WHERE id = _request_id;
    RETURN FALSE;
  END IF;
  IF request_row.action_type = 'activate_emergency_mode' THEN
    UPDATE public.admin_platform_settings
    SET registration_mode = 'closed', support_widget_enabled = FALSE,
        support_widget_id = NULL, maintenance_mode = TRUE, updated_at = pg_catalog.now()
    WHERE singleton = TRUE;
  ELSIF request_row.action_type = 'close_all_sessions' THEN
    UPDATE auth.refresh_tokens
    SET revoked = TRUE, updated_at = pg_catalog.now()
    WHERE revoked = FALSE;
    DELETE FROM auth.sessions;
  ELSE
    RAISE EXCEPTION 'invalid_danger_action_type' USING ERRCODE = '22023';
  END IF;
  UPDATE public.danger_action_requests
  SET status = 'executed', updated_at = pg_catalog.now()
  WHERE id = _request_id;
  PERFORM public.append_admin_audit_event(
    pg_catalog.gen_random_uuid(), _actor_user_id, NULL,
    'user.lifecycle.changed', 'succeeded', 'DANGER_ACTION_EXECUTED', NULL
  );
  RETURN TRUE;
EXCEPTION WHEN OTHERS THEN
  UPDATE public.danger_action_requests
  SET status = 'failed', failure_code = 'EXECUTION_FAILED', updated_at = pg_catalog.now()
  WHERE id = _request_id AND status IN ('scheduled', 'approved');
  RETURN FALSE;
END;
$$;

REVOKE ALL ON FUNCTION public.get_admin_danger_policy(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.request_admin_danger_action(TEXT, TEXT, UUID, UUID)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.approve_admin_danger_action(UUID, UUID)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_admin_danger_action(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.execute_admin_danger_action(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_danger_policy(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.request_admin_danger_action(TEXT, TEXT, UUID, UUID)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_admin_danger_action(UUID, UUID)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_admin_danger_action(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.execute_admin_danger_action(UUID, UUID) TO service_role;

COMMENT ON TABLE public.user_permission_overrides IS
  'Deny-by-default per-user permission overrides. Contains no Vault data or direct PII.';
COMMENT ON TABLE public.admin_notifications IS
  'Code-only administrative inbox. Free-form messages, recipients and Vault data are forbidden.';
COMMENT ON TABLE public.danger_action_requests IS
  'Adaptive, audited admin danger requests using one-time project reauthentication proofs.';

CREATE OR REPLACE FUNCTION public.list_admin_audit_events_v2(
  _actor_user_id UUID,
  _limit INTEGER DEFAULT 50,
  _event_type TEXT DEFAULT NULL,
  _outcome TEXT DEFAULT NULL,
  _cursor_occurred_at TIMESTAMPTZ DEFAULT NULL,
  _cursor_id UUID DEFAULT NULL,
  _for_export BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
  id UUID,
  actor_user_id UUID,
  target_user_id UUID,
  event_type TEXT,
  outcome TEXT,
  detail_code TEXT,
  reason_code TEXT,
  occurred_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF _actor_user_id IS NULL
    OR _limit IS NULL
    OR _limit < 1
    OR _limit > (CASE WHEN _for_export THEN 1000 ELSE 100 END)
    OR ((_cursor_occurred_at IS NULL) <> (_cursor_id IS NULL))
    OR (_event_type IS NOT NULL AND _event_type NOT IN (
      'team.role.changed', 'team.permission.changed', 'user.lifecycle.changed',
      'user.deleted', 'security.rule.changed'
    ))
    OR (_outcome IS NOT NULL AND _outcome NOT IN ('started', 'succeeded', 'failed', 'denied'))
  THEN
    RAISE EXCEPTION 'invalid_admin_audit_query' USING ERRCODE = '22023';
  END IF;
  IF NOT public.has_permission(_actor_user_id, 'admin.audit.read')
    OR (_for_export AND NOT public.has_permission(_actor_user_id, 'admin.audit.export'))
  THEN
    RAISE EXCEPTION 'insufficient_permissions' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT
    audit.id, audit.actor_user_id, audit.target_user_id, audit.event_type,
    audit.outcome, audit.detail_code, audit.reason_code, audit.occurred_at
  FROM public.admin_audit_log AS audit
  WHERE (_event_type IS NULL OR audit.event_type = _event_type)
    AND (_outcome IS NULL OR audit.outcome = _outcome)
    AND (_cursor_occurred_at IS NULL OR
      (audit.occurred_at, audit.id) < (_cursor_occurred_at, _cursor_id))
  ORDER BY audit.occurred_at DESC, audit.id DESC
  LIMIT _limit;
END;
$$;
REVOKE ALL ON FUNCTION public.list_admin_audit_events_v2(
  UUID, INTEGER, TEXT, TEXT, TIMESTAMPTZ, UUID, BOOLEAN
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_admin_audit_events_v2(
  UUID, INTEGER, TEXT, TEXT, TIMESTAMPTZ, UUID, BOOLEAN
) TO service_role;
