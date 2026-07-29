-- Align admin authorization RPCs with TEXT team roles (20260714070000).
-- Remaining app_role casts break comparisons against user_roles.role (text).

DROP FUNCTION IF EXISTS public.has_role(UUID, public.app_role);
DROP FUNCTION IF EXISTS public.admin_set_team_member_role(UUID, UUID, public.app_role);
DROP FUNCTION IF EXISTS public.admin_set_role_permission(UUID, public.app_role, TEXT, BOOLEAN);

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.user_roles
        WHERE user_id = _user_id
          AND role = _role
    );
$$;

GRANT EXECUTE ON FUNCTION public.has_role(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(UUID, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.list_admin_audit_events(
  _actor_user_id UUID,
  _limit INTEGER DEFAULT 50,
  _event_type TEXT DEFAULT NULL,
  _outcome TEXT DEFAULT NULL
)
RETURNS TABLE (
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
  IF _actor_user_id IS NULL OR _limit IS NULL OR _limit < 1 OR _limit > 100 THEN
    RAISE EXCEPTION 'invalid_admin_audit_query' USING ERRCODE = '22023';
  END IF;

  IF _event_type IS NOT NULL AND _event_type NOT IN (
    'team.role.changed',
    'team.permission.changed',
    'user.lifecycle.changed',
    'user.deleted'
  ) THEN
    RAISE EXCEPTION 'invalid_admin_audit_event_type' USING ERRCODE = '22023';
  END IF;

  IF _outcome IS NOT NULL AND _outcome NOT IN (
    'started', 'succeeded', 'failed', 'denied'
  ) THEN
    RAISE EXCEPTION 'invalid_admin_audit_outcome' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.user_roles AS actor_role
    JOIN public.role_permissions AS permission
      ON permission.role = actor_role.role
    WHERE actor_role.user_id = _actor_user_id
      AND actor_role.role = 'admin'
      AND permission.permission_key = 'admin.audit.read'
  ) THEN
    RAISE EXCEPTION 'insufficient_permissions' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    audit.actor_user_id,
    audit.target_user_id,
    audit.event_type,
    audit.outcome,
    audit.detail_code,
    audit.reason_code,
    audit.occurred_at
  FROM public.admin_audit_log AS audit
  WHERE (_event_type IS NULL OR audit.event_type = _event_type)
    AND (_outcome IS NULL OR audit.outcome = _outcome)
  ORDER BY audit.occurred_at DESC, audit.id DESC
  LIMIT _limit;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_admin_security_summary(
  _actor_user_id UUID
)
RETURNS TABLE (
  failed_attempts_1h BIGINT,
  failed_attempts_24h BIGINT,
  active_lockouts BIGINT,
  last_attempt_at TIMESTAMPTZ,
  window_started_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF _actor_user_id IS NULL THEN
    RAISE EXCEPTION 'invalid_admin_security_query' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.user_roles AS actor_role
    JOIN public.role_permissions AS permission
      ON permission.role = actor_role.role
    WHERE actor_role.user_id = _actor_user_id
      AND actor_role.role = 'admin'
      AND permission.permission_key = 'admin.security.read'
  ) THEN
    RAISE EXCEPTION 'insufficient_permissions' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    COUNT(*) FILTER (
      WHERE attempts.success = FALSE
        AND attempts.attempted_at >= pg_catalog.now() - INTERVAL '1 hour'
    )::BIGINT,
    COUNT(*) FILTER (
      WHERE attempts.success = FALSE
        AND attempts.attempted_at >= pg_catalog.now() - INTERVAL '24 hours'
    )::BIGINT,
    COUNT(DISTINCT (attempts.identifier, attempts.action)) FILTER (
      WHERE attempts.locked_until > pg_catalog.now()
    )::BIGINT,
    MAX(attempts.attempted_at) FILTER (
      WHERE attempts.attempted_at >= pg_catalog.now() - INTERVAL '24 hours'
    ),
    pg_catalog.now() - INTERVAL '24 hours'
  FROM public.rate_limit_attempts AS attempts;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_admin_system_status(
  _actor_user_id UUID
)
RETURNS TABLE (
  database_reachable BOOLEAN,
  private_attachment_storage_configured BOOLEAN,
  admin_audit_store_protected BOOLEAN,
  scheduler_available BOOLEAN,
  checked_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF _actor_user_id IS NULL THEN
    RAISE EXCEPTION 'invalid_admin_system_query' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.user_roles AS actor_role
    JOIN public.role_permissions AS permission
      ON permission.role = actor_role.role
    WHERE actor_role.user_id = _actor_user_id
      AND actor_role.role = 'admin'
      AND permission.permission_key = 'admin.system.read'
  ) THEN
    RAISE EXCEPTION 'insufficient_permissions' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    TRUE,
    EXISTS (
      SELECT 1
      FROM storage.buckets AS bucket
      WHERE bucket.id = 'vault-attachments'
        AND bucket.public = FALSE
    ),
    COALESCE((
      SELECT relation.relrowsecurity
        AND relation.relforcerowsecurity
        AND EXISTS (
          SELECT 1
          FROM pg_catalog.pg_trigger AS row_trigger
          WHERE row_trigger.tgrelid = relation.oid
            AND row_trigger.tgname = 'prevent_admin_audit_log_row_mutation'
            AND row_trigger.tgenabled IN ('O', 'A')
            AND row_trigger.tgfoid = 'public.prevent_admin_audit_log_mutation()'::pg_catalog.regprocedure
            AND row_trigger.tgtype = 27
        )
        AND EXISTS (
          SELECT 1
          FROM pg_catalog.pg_trigger AS truncate_trigger
          WHERE truncate_trigger.tgrelid = relation.oid
            AND truncate_trigger.tgname = 'prevent_admin_audit_log_truncate'
            AND truncate_trigger.tgenabled IN ('O', 'A')
            AND truncate_trigger.tgfoid = 'public.prevent_admin_audit_log_mutation()'::pg_catalog.regprocedure
            AND truncate_trigger.tgtype = 34
        )
      FROM pg_catalog.pg_class AS relation
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public'
        AND relation.relname = 'admin_audit_log'
    ), FALSE),
    EXISTS (
      SELECT 1
      FROM pg_catalog.pg_extension AS extension
      WHERE extension.extname = 'pg_cron'
    ),
    pg_catalog.now();
END;
$$;

CREATE OR REPLACE FUNCTION public.get_admin_global_settings(
  _actor_user_id UUID
)
RETURNS TABLE (
  registration_mode TEXT,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF _actor_user_id IS NULL THEN
    RAISE EXCEPTION 'invalid_admin_settings_query' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.user_roles AS actor_role
    JOIN public.role_permissions AS permission
      ON permission.role = actor_role.role
    WHERE actor_role.user_id = _actor_user_id
      AND actor_role.role = 'admin'
      AND permission.permission_key = 'admin.settings.read'
  ) THEN
    RAISE EXCEPTION 'insufficient_permissions' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT settings.registration_mode, settings.updated_at
  FROM public.admin_platform_settings AS settings
  WHERE settings.singleton = TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.list_admin_audit_events(UUID, INTEGER, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_admin_audit_events(UUID, INTEGER, TEXT, TEXT)
  TO service_role;

REVOKE ALL ON FUNCTION public.get_admin_security_summary(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_security_summary(UUID)
  TO service_role;

REVOKE ALL ON FUNCTION public.get_admin_system_status(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_system_status(UUID)
  TO service_role;

REVOKE ALL ON FUNCTION public.get_admin_global_settings(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_global_settings(UUID)
  TO service_role;