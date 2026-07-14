-- Central registration policy with deny-by-default storage access.
INSERT INTO public.team_permissions (permission_key, label, description, category)
VALUES (
  'admin.settings.read',
  'Read Global Settings',
  'View effective global product policies without infrastructure or secret details.',
  'admin'
)
ON CONFLICT (permission_key) DO UPDATE
SET label = EXCLUDED.label,
    description = EXCLUDED.description,
    category = EXCLUDED.category;

INSERT INTO public.role_permissions (role, permission_key)
VALUES ('admin'::public.app_role, 'admin.settings.read')
ON CONFLICT (role, permission_key) DO NOTHING;

CREATE TABLE public.admin_platform_settings (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  registration_mode TEXT NOT NULL DEFAULT 'open'
    CHECK (registration_mode IN ('open', 'closed')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now()
);

INSERT INTO public.admin_platform_settings (singleton, registration_mode)
VALUES (TRUE, 'open')
ON CONFLICT (singleton) DO NOTHING;

ALTER TABLE public.admin_platform_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_platform_settings FORCE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.admin_platform_settings
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.is_public_registration_open()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE((
    SELECT settings.registration_mode = 'open'
    FROM public.admin_platform_settings AS settings
    WHERE settings.singleton = TRUE
  ), FALSE);
$$;

REVOKE ALL ON FUNCTION public.is_public_registration_open()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_public_registration_open()
  TO service_role;

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
      AND actor_role.role = 'admin'::public.app_role
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

REVOKE ALL ON FUNCTION public.get_admin_global_settings(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_global_settings(UUID)
  TO service_role;

COMMENT ON TABLE public.admin_platform_settings IS
  'Singleton global policy storage. Contains no user, Vault, secret or infrastructure data.';
COMMENT ON FUNCTION public.is_public_registration_open() IS
  'Service-role-only fail-closed registration policy check used before creating signup state.';
COMMENT ON FUNCTION public.get_admin_global_settings(UUID) IS
  'Service-role-only admin read contract for effective non-secret global policies.';
