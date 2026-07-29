-- Central, data-minimizing audit foundation for administrative actions.
-- Historical team_access_audit_log rows remain untouched and readable through
-- their existing compatibility path until a later, reviewed migration.
CREATE TABLE public.admin_audit_log (
  id UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  operation_id UUID NOT NULL,
  actor_user_id UUID NOT NULL,
  target_user_id UUID,
  event_type TEXT NOT NULL,
  outcome TEXT NOT NULL,
  detail_code TEXT,
  reason_code TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT admin_audit_log_event_type_check CHECK (
    event_type IN (
      'team.role.changed',
      'team.permission.changed',
      'user.lifecycle.changed',
      'user.deleted'
    )
  ),
  CONSTRAINT admin_audit_log_outcome_check CHECK (
    outcome IN ('started', 'succeeded', 'failed', 'denied')
  ),
  CONSTRAINT admin_audit_log_detail_code_check CHECK (
    detail_code IS NULL OR detail_code ~ '^[A-Z][A-Z0-9_]{0,63}$'
  ),
  CONSTRAINT admin_audit_log_reason_code_check CHECK (
    reason_code IS NULL OR reason_code ~ '^[A-Z][A-Z0-9_]{0,63}$'
  )
);

CREATE INDEX admin_audit_log_occurred_at_idx
  ON public.admin_audit_log (occurred_at DESC);
CREATE INDEX admin_audit_log_operation_id_idx
  ON public.admin_audit_log (operation_id);
CREATE INDEX admin_audit_log_actor_user_id_idx
  ON public.admin_audit_log (actor_user_id, occurred_at DESC);
CREATE INDEX admin_audit_log_target_user_id_idx
  ON public.admin_audit_log (target_user_id, occurred_at DESC)
  WHERE target_user_id IS NOT NULL;

ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_audit_log FORCE ROW LEVEL SECURITY;

-- No application role receives direct table access. Writes are possible only
-- through the narrow SECURITY DEFINER append function below.
REVOKE ALL PRIVILEGES ON TABLE public.admin_audit_log
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.prevent_admin_audit_log_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'admin_audit_log_is_append_only' USING ERRCODE = '42501';
END;
$$;

REVOKE ALL ON FUNCTION public.prevent_admin_audit_log_mutation() FROM PUBLIC;

CREATE TRIGGER prevent_admin_audit_log_row_mutation
  BEFORE UPDATE OR DELETE ON public.admin_audit_log
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_admin_audit_log_mutation();

CREATE TRIGGER prevent_admin_audit_log_truncate
  BEFORE TRUNCATE ON public.admin_audit_log
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.prevent_admin_audit_log_mutation();

CREATE OR REPLACE FUNCTION public.append_admin_audit_event(
  _operation_id UUID,
  _actor_user_id UUID,
  _target_user_id UUID,
  _event_type TEXT,
  _outcome TEXT,
  _detail_code TEXT DEFAULT NULL,
  _reason_code TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  audit_event_id UUID;
BEGIN
  IF _operation_id IS NULL OR _actor_user_id IS NULL THEN
    RAISE EXCEPTION 'invalid_admin_audit_identity' USING ERRCODE = '22004';
  END IF;

  INSERT INTO public.admin_audit_log (
    operation_id,
    actor_user_id,
    target_user_id,
    event_type,
    outcome,
    detail_code,
    reason_code
  )
  VALUES (
    _operation_id,
    _actor_user_id,
    _target_user_id,
    _event_type,
    _outcome,
    _detail_code,
    _reason_code
  )
  RETURNING id INTO audit_event_id;

  RETURN audit_event_id;
END;
$$;

REVOKE ALL ON FUNCTION public.append_admin_audit_event(
  UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.append_admin_audit_event(
  UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT
) TO service_role;

COMMENT ON TABLE public.admin_audit_log IS
  'Append-only application audit events. Contains stable identifiers and constrained codes only; never Vault data or free-form PII.';
COMMENT ON FUNCTION public.append_admin_audit_event(UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT) IS
  'Service-role-only append boundary for constrained administrative audit events.';

-- Route the existing atomic role change through the central audit boundary.
CREATE OR REPLACE FUNCTION public.admin_set_team_member_role(
  _actor_user_id UUID,
  _target_user_id UUID,
  _role public.app_role
)
RETURNS public.app_role
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  admin_count BIGINT;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('admin_set_team_member_role', 0)
  );

  IF _actor_user_id = _target_user_id THEN
    RAISE EXCEPTION 'self_role_change_forbidden' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.user_roles AS actor_role
    JOIN public.role_permissions AS permission
      ON permission.role = actor_role.role
    WHERE actor_role.user_id = _actor_user_id
      AND actor_role.role = 'admin'::public.app_role
      AND permission.permission_key = 'team.roles.manage'
  ) THEN
    RAISE EXCEPTION 'insufficient_permissions' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = _target_user_id) THEN
    RAISE EXCEPTION 'target_user_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF _role <> 'admin'::public.app_role
    AND EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = _target_user_id AND role = 'admin'::public.app_role
    )
  THEN
    SELECT COUNT(*) INTO admin_count
    FROM public.user_roles
    WHERE role = 'admin'::public.app_role;

    IF admin_count <= 1 THEN
      RAISE EXCEPTION 'last_admin_protected' USING ERRCODE = '42501';
    END IF;
  END IF;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (_target_user_id, 'user'::public.app_role)
  ON CONFLICT (user_id, role) DO NOTHING;

  DELETE FROM public.user_roles
  WHERE user_id = _target_user_id
    AND role IN ('admin'::public.app_role, 'moderator'::public.app_role);

  IF _role <> 'user'::public.app_role THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (_target_user_id, _role)
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;

  PERFORM public.append_admin_audit_event(
    pg_catalog.gen_random_uuid(),
    _actor_user_id,
    _target_user_id,
    'team.role.changed',
    'succeeded',
    'ROLE_' || pg_catalog.upper(_role::TEXT),
    NULL
  );

  RETURN _role;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_team_member_role(UUID, UUID, public.app_role)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_team_member_role(UUID, UUID, public.app_role)
  TO service_role;

COMMENT ON FUNCTION public.admin_set_team_member_role(UUID, UUID, public.app_role) IS
  'Atomically assigns an internal team role and appends a constrained central audit event.';