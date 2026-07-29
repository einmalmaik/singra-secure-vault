-- Privacy-preserving, aggregate-only security center foundation.
INSERT INTO public.team_permissions (permission_key, label, description, category)
VALUES (
  'admin.security.read',
  'Read Security Summary',
  'View aggregate authentication throttling signals without identifiers, IP addresses or Vault data.',
  'admin'
)
ON CONFLICT (permission_key) DO UPDATE
SET label = EXCLUDED.label,
    description = EXCLUDED.description,
    category = EXCLUDED.category;

INSERT INTO public.role_permissions (role, permission_key)
VALUES ('admin'::public.app_role, 'admin.security.read')
ON CONFLICT (role, permission_key) DO NOTHING;

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
      AND actor_role.role = 'admin'::public.app_role
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

REVOKE ALL ON FUNCTION public.get_admin_security_summary(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_security_summary(UUID)
  TO service_role;

COMMENT ON FUNCTION public.get_admin_security_summary(UUID) IS
  'Service-role-only aggregate throttling summary with database-level admin authorization and no direct identifiers.';
