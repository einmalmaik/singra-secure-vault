-- Keep role assignment and its audit entry atomic.
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

  INSERT INTO public.team_access_audit_log (
    actor_user_id,
    target_user_id,
    action,
    payload
  )
  VALUES (
    _actor_user_id,
    _target_user_id,
    'set_member_role',
    jsonb_build_object('role', _role::TEXT)
  );

  RETURN _role;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_team_member_role(UUID, UUID, public.app_role)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_team_member_role(UUID, UUID, public.app_role)
  TO service_role;

COMMENT ON FUNCTION public.admin_set_team_member_role(UUID, UUID, public.app_role) IS
  'Atomically assigns an internal team role and records the authorized change.';