-- Keep permission changes, lockout protection and central audit atomic.
CREATE OR REPLACE FUNCTION public.admin_set_role_permission(
  _actor_user_id UUID,
  _role public.app_role,
  _permission_key TEXT,
  _enabled BOOLEAN
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  audit_detail_code TEXT;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('admin_set_role_permission', 0)
  );

  IF _actor_user_id IS NULL
    OR _enabled IS NULL
    OR _role NOT IN ('admin'::public.app_role, 'moderator'::public.app_role)
    OR _permission_key IS NULL
    OR pg_catalog.length(_permission_key) = 0
  THEN
    RAISE EXCEPTION 'invalid_role_permission_payload' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.user_roles AS actor_role
    JOIN public.role_permissions AS permission
      ON permission.role = actor_role.role
    WHERE actor_role.user_id = _actor_user_id
      AND actor_role.role = 'admin'::public.app_role
      AND permission.permission_key = 'team.permissions.manage'
  ) THEN
    RAISE EXCEPTION 'insufficient_permissions' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.team_permissions
    WHERE permission_key = _permission_key
  ) THEN
    RAISE EXCEPTION 'unknown_permission_key' USING ERRCODE = '22023';
  END IF;

  IF _role = 'admin'::public.app_role
    AND NOT _enabled
    AND _permission_key IN (
      'team.roles.read',
      'team.roles.manage',
      'team.permissions.read',
      'team.permissions.manage',
      'admin.audit.read'
    )
  THEN
    RAISE EXCEPTION 'protected_admin_permission' USING ERRCODE = '42501';
  END IF;

  audit_detail_code :=
    'ROLE_' || pg_catalog.upper(_role::TEXT) || '_' ||
    pg_catalog.regexp_replace(pg_catalog.upper(_permission_key), '[^A-Z0-9]+', '_', 'g') ||
    CASE WHEN _enabled THEN '_ENABLED' ELSE '_DISABLED' END;

  IF pg_catalog.length(audit_detail_code) > 64 THEN
    RAISE EXCEPTION 'permission_audit_code_too_long' USING ERRCODE = '22023';
  END IF;

  IF _enabled THEN
    INSERT INTO public.role_permissions (role, permission_key)
    VALUES (_role, _permission_key)
    ON CONFLICT (role, permission_key) DO NOTHING;
  ELSE
    DELETE FROM public.role_permissions
    WHERE role = _role AND permission_key = _permission_key;
  END IF;

  PERFORM public.append_admin_audit_event(
    pg_catalog.gen_random_uuid(),
    _actor_user_id,
    NULL,
    'team.permission.changed',
    'succeeded',
    audit_detail_code,
    NULL
  );

  RETURN _enabled;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_role_permission(UUID, public.app_role, TEXT, BOOLEAN)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_role_permission(UUID, public.app_role, TEXT, BOOLEAN)
  TO service_role;

COMMENT ON FUNCTION public.admin_set_role_permission(UUID, public.app_role, TEXT, BOOLEAN) IS
  'Atomically changes a role permission, protects minimum admin access and appends a constrained central audit event.';
