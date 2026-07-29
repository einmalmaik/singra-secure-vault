-- Server-side masked search and cursor pagination for the Premium admin directory.
CREATE OR REPLACE FUNCTION public.get_admin_user_directory(
  _actor_user_id UUID,
  _search TEXT,
  _limit INTEGER,
  _cursor_created_at TIMESTAMPTZ,
  _cursor_id UUID
)
RETURNS TABLE(
  user_id UUID,
  masked_email TEXT,
  account_status TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  normalized_search TEXT := pg_catalog.lower(pg_catalog.btrim(COALESCE(_search, '')));
BEGIN
  IF NOT public.has_permission(_actor_user_id, 'team.roles.read') THEN
    RAISE EXCEPTION 'insufficient_permissions' USING ERRCODE = '42501';
  END IF;
  IF _limit IS NULL OR _limit < 1 OR _limit > 101
    OR pg_catalog.length(normalized_search) > 120
  THEN
    RAISE EXCEPTION 'invalid_user_directory_query' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT
    auth_user.id,
    CASE
      WHEN auth_user.email IS NULL THEN NULL
      ELSE
        COALESCE(NULLIF(pg_catalog.left(pg_catalog.split_part(auth_user.email::TEXT, '@', 1), 1), ''), '*')
        || '***@'
        || COALESCE(NULLIF(pg_catalog.left(pg_catalog.split_part(pg_catalog.split_part(auth_user.email::TEXT, '@', 2), '.', 1), 1), ''), '*')
        || '***'
        || CASE
          WHEN pg_catalog.strpos(pg_catalog.split_part(auth_user.email::TEXT, '@', 2), '.') > 0
          THEN '.' || pg_catalog.reverse(pg_catalog.split_part(pg_catalog.reverse(pg_catalog.split_part(auth_user.email::TEXT, '@', 2)), '.', 1))
          ELSE ''
        END
    END,
    CASE
      WHEN auth_user.banned_until IS NOT NULL AND auth_user.banned_until > pg_catalog.now()
      THEN 'suspended'
      ELSE 'active'
    END,
    auth_user.created_at
  FROM auth.users AS auth_user
  WHERE (
      normalized_search = ''
      OR pg_catalog.lower(COALESCE(auth_user.email::TEXT, '')) LIKE '%' || normalized_search || '%'
    )
    AND (
      _cursor_created_at IS NULL
      OR auth_user.created_at < _cursor_created_at
      OR (auth_user.created_at = _cursor_created_at AND auth_user.id < _cursor_id)
    )
  ORDER BY auth_user.created_at DESC, auth_user.id DESC
  LIMIT _limit;
END;
$$;

REVOKE ALL ON FUNCTION public.get_admin_user_directory(UUID, TEXT, INTEGER, TIMESTAMPTZ, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_user_directory(UUID, TEXT, INTEGER, TIMESTAMPTZ, UUID)
  TO service_role;
