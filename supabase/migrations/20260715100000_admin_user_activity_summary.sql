-- Pseudonymized user activity aggregates for the admin overview.
-- Returns counts only; no user ids, emails, or vault data.

CREATE OR REPLACE FUNCTION public.get_admin_user_activity_summary(
  _actor_user_id UUID
)
RETURNS TABLE (
  active_accounts INTEGER,
  suspended_accounts INTEGER,
  sign_ins_last_24h INTEGER,
  sign_ins_last_7d INTEGER,
  last_observed_sign_in_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF _actor_user_id IS NULL THEN
    RAISE EXCEPTION 'invalid_admin_user_activity_actor' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.user_roles AS actor_role
    JOIN public.role_permissions AS permission
      ON permission.role = actor_role.role
    WHERE actor_role.user_id = _actor_user_id
      AND actor_role.role = 'admin'
      AND permission.permission_key = 'team.roles.read'
  ) THEN
    RAISE EXCEPTION 'insufficient_permissions' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    pg_catalog.count(*) FILTER (
      WHERE users.banned_until IS NULL
        OR users.banned_until <= pg_catalog.timezone('utc', pg_catalog.now())
    )::INTEGER AS active_accounts,
    pg_catalog.count(*) FILTER (
      WHERE users.banned_until IS NOT NULL
        AND users.banned_until > pg_catalog.timezone('utc', pg_catalog.now())
    )::INTEGER AS suspended_accounts,
    pg_catalog.count(*) FILTER (
      WHERE users.last_sign_in_at IS NOT NULL
        AND users.last_sign_in_at >= pg_catalog.timezone('utc', pg_catalog.now()) - INTERVAL '24 hours'
    )::INTEGER AS sign_ins_last_24h,
    pg_catalog.count(*) FILTER (
      WHERE users.last_sign_in_at IS NOT NULL
        AND users.last_sign_in_at >= pg_catalog.timezone('utc', pg_catalog.now()) - INTERVAL '7 days'
    )::INTEGER AS sign_ins_last_7d,
    pg_catalog.max(users.last_sign_in_at) AS last_observed_sign_in_at
  FROM auth.users AS users;
END;
$$;

REVOKE ALL ON FUNCTION public.get_admin_user_activity_summary(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_admin_user_activity_summary(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.get_admin_user_activity_summary(UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_user_activity_summary(UUID) TO service_role;