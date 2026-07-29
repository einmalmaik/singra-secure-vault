-- SQL Migration: Dynamic Roles and Danger Zone with Four-Eyes Principle
-- Timestamp: 20260714070000

-- ============================================
-- 1) Create team_roles Table
-- ============================================
CREATE TABLE IF NOT EXISTS public.team_roles (
    role_name TEXT PRIMARY KEY,
    description TEXT,
    is_system BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT pg_catalog.now() NOT NULL
);

-- Seed initial system roles
INSERT INTO public.team_roles (role_name, description, is_system) VALUES
('admin', 'Administrator mit vollem Systemzugriff', true),
('moderator', 'Moderator für Support und Team-Einsicht', true),
('user', 'Standard-Benutzer ohne administrative Rechte', true)
ON CONFLICT (role_name) DO UPDATE
SET description = EXCLUDED.description, is_system = EXCLUDED.is_system;

-- ============================================
-- 2) Update user_roles and role_permissions to TEXT
-- ============================================
-- Drop policies depending on role columns
DROP POLICY IF EXISTS "Team can view internal roles" ON public.user_roles;
DROP POLICY IF EXISTS "Team can insert internal roles" ON public.user_roles;
DROP POLICY IF EXISTS "Team can delete internal roles" ON public.user_roles;
DROP POLICY IF EXISTS "Role permissions insert" ON public.role_permissions;
DROP POLICY IF EXISTS "Role permissions update" ON public.role_permissions;
DROP POLICY IF EXISTS "Role permissions delete" ON public.role_permissions;

-- Drop constraints temporarily
ALTER TABLE public.user_roles DROP CONSTRAINT IF EXISTS user_roles_user_id_role_key;
ALTER TABLE public.role_permissions DROP CONSTRAINT IF EXISTS role_permissions_role_permission_key_key;
ALTER TABLE public.user_roles DROP CONSTRAINT IF EXISTS user_roles_role_fkey;
ALTER TABLE public.role_permissions DROP CONSTRAINT IF EXISTS role_permissions_role_fkey;
ALTER TABLE public.role_permissions DROP CONSTRAINT IF EXISTS role_permissions_internal_roles_only;

-- Convert column types
ALTER TABLE public.user_roles ALTER COLUMN role TYPE TEXT;
ALTER TABLE public.role_permissions ALTER COLUMN role TYPE TEXT;

-- Set default value to 'user'
ALTER TABLE public.user_roles ALTER COLUMN role SET DEFAULT 'user';

-- Re-add constraints and foreign keys
ALTER TABLE public.user_roles ADD CONSTRAINT user_roles_user_id_role_key UNIQUE (user_id, role);
ALTER TABLE public.role_permissions ADD CONSTRAINT role_permissions_role_permission_key_key UNIQUE (role, permission_key);

ALTER TABLE public.user_roles ADD CONSTRAINT user_roles_role_fkey FOREIGN KEY (role) REFERENCES public.team_roles(role_name) ON DELETE CASCADE;
ALTER TABLE public.role_permissions ADD CONSTRAINT role_permissions_role_fkey FOREIGN KEY (role) REFERENCES public.team_roles(role_name) ON DELETE CASCADE;

-- Recreate RLS Policies supporting dynamic roles
CREATE POLICY "Team can view internal roles"
    ON public.user_roles FOR SELECT
    TO authenticated
    USING (
        role != 'user'
        AND (
            public.has_permission(auth.uid(), 'team.roles.read')
            OR public.has_permission(auth.uid(), 'team.roles.manage')
        )
    );

CREATE POLICY "Team can insert internal roles"
    ON public.user_roles FOR INSERT
    TO authenticated
    WITH CHECK (
        public.has_permission(auth.uid(), 'team.roles.manage')
        AND role != 'user'
    );

CREATE POLICY "Team can delete internal roles"
    ON public.user_roles FOR DELETE
    TO authenticated
    USING (
        public.has_permission(auth.uid(), 'team.roles.manage')
        AND role != 'user'
    );

CREATE POLICY "Role permissions insert"
    ON public.role_permissions FOR INSERT
    TO authenticated
    WITH CHECK (
        public.has_permission(auth.uid(), 'team.permissions.manage')
        AND role != 'user'
    );

CREATE POLICY "Role permissions update"
    ON public.role_permissions FOR UPDATE
    TO authenticated
    USING (
        public.has_permission(auth.uid(), 'team.permissions.manage')
        AND role != 'user'
    )
    WITH CHECK (
        public.has_permission(auth.uid(), 'team.permissions.manage')
        AND role != 'user'
    );

CREATE POLICY "Role permissions delete"
    ON public.role_permissions FOR DELETE
    TO authenticated
    USING (
        public.has_permission(auth.uid(), 'team.permissions.manage')
        AND role != 'user'
    );

-- ============================================
-- 3) Rewrite Helper Functions to use TEXT
-- ============================================
CREATE OR REPLACE FUNCTION public.has_permission(_user_id UUID, _permission_key TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.user_roles ur
        JOIN public.role_permissions rp
          ON rp.role = ur.role
        WHERE ur.user_id = _user_id
          AND rp.permission_key = _permission_key
    );
$$;

CREATE OR REPLACE FUNCTION public.get_my_permissions()
RETURNS TABLE(permission_key TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT DISTINCT rp.permission_key
    FROM public.user_roles ur
    JOIN public.role_permissions rp
      ON rp.role = ur.role
    WHERE ur.user_id = auth.uid();
$$;

-- ============================================
-- 4) Rewrite admin_set_team_member_role Function
-- ============================================
CREATE OR REPLACE FUNCTION public.admin_set_team_member_role(
  _actor_user_id UUID,
  _target_user_id UUID,
  _role TEXT
)
RETURNS TEXT
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
      AND actor_role.role = 'admin'
      AND permission.permission_key = 'team.roles.manage'
  ) THEN
    RAISE EXCEPTION 'insufficient_permissions' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = _target_user_id) THEN
    RAISE EXCEPTION 'target_user_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.team_roles WHERE role_name = _role) THEN
    RAISE EXCEPTION 'invalid_role' USING ERRCODE = '22023';
  END IF;

  -- Last admin safety check
  IF _role <> 'admin' AND EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _target_user_id AND role = 'admin'
  ) THEN
    SELECT COUNT(*) INTO admin_count
    FROM public.user_roles
    WHERE role = 'admin';

    IF admin_count <= 1 THEN
      RAISE EXCEPTION 'last_admin_protected' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Remove internal team roles (moderator, admin)
  DELETE FROM public.user_roles
  WHERE user_id = _target_user_id
    AND role <> 'user';

  -- Add the new role (if not user, which is default)
  IF _role <> 'user' THEN
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
    'ROLE_' || pg_catalog.upper(_role),
    NULL
  );

  RETURN _role;
END;
$$;

-- ============================================
-- 5) Rewrite admin_set_role_permission Function
-- ============================================
CREATE OR REPLACE FUNCTION public.admin_set_role_permission(
  _actor_user_id UUID,
  _role TEXT,
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
    OR _role IS NULL
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
      AND actor_role.role = 'admin'
      AND permission.permission_key = 'team.permissions.manage'
  ) THEN
    RAISE EXCEPTION 'insufficient_permissions' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.team_roles WHERE role_name = _role) THEN
    RAISE EXCEPTION 'invalid_role' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.team_permissions
    WHERE permission_key = _permission_key
  ) THEN
    RAISE EXCEPTION 'unknown_permission_key' USING ERRCODE = '22023';
  END IF;

  -- Protected admin permission check
  IF _role = 'admin'
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
    'ROLE_' || pg_catalog.upper(_role) || '_' ||
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

-- ============================================
-- 6) Custom Roles Admin Administration
-- ============================================
CREATE OR REPLACE FUNCTION public.admin_create_role(
  _actor_user_id UUID,
  _role_name TEXT,
  _description TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.user_roles AS actor_role
    JOIN public.role_permissions AS permission
      ON permission.role = actor_role.role
    WHERE actor_role.user_id = _actor_user_id
      AND actor_role.role = 'admin'
      AND permission.permission_key = 'team.roles.manage'
  ) THEN
    RAISE EXCEPTION 'insufficient_permissions' USING ERRCODE = '42501';
  END IF;

  IF _role_name IS NULL OR pg_catalog.length(_role_name) < 2 OR _role_name ~ '[^a-zA-Z0-9_]' THEN
    RAISE EXCEPTION 'invalid_role_name' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.team_roles (role_name, description, is_system)
  VALUES (_role_name, _description, false);

  PERFORM public.append_admin_audit_event(
    pg_catalog.gen_random_uuid(),
    _actor_user_id,
    NULL,
    'team.role.changed',
    'succeeded',
    'ROLE_CREATED_' || pg_catalog.upper(_role_name),
    NULL
  );

  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_delete_role(
  _actor_user_id UUID,
  _role_name TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.user_roles AS actor_role
    JOIN public.role_permissions AS permission
      ON permission.role = actor_role.role
    WHERE actor_role.user_id = _actor_user_id
      AND actor_role.role = 'admin'
      AND permission.permission_key = 'team.roles.manage'
  ) THEN
    RAISE EXCEPTION 'insufficient_permissions' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.team_roles
    WHERE role_name = _role_name AND is_system = true
  ) THEN
    RAISE EXCEPTION 'cannot_delete_system_role' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.team_roles WHERE role_name = _role_name;

  PERFORM public.append_admin_audit_event(
    pg_catalog.gen_random_uuid(),
    _actor_user_id,
    NULL,
    'team.role.changed',
    'succeeded',
    'ROLE_DELETED_' || pg_catalog.upper(_role_name),
    NULL
  );

  RETURN TRUE;
END;
$$;

-- ============================================
-- 7) Danger Zone Request/Approval System
-- ============================================
CREATE TABLE IF NOT EXISTS public.danger_action_requests (
    id UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
    action_type TEXT NOT NULL,
    requested_by UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    approved_by UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT pg_catalog.now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT pg_catalog.now() NOT NULL,
    CONSTRAINT danger_action_requests_status_check CHECK (status IN ('pending', 'approved', 'rejected')),
    CONSTRAINT danger_action_requests_action_type_check CHECK (action_type IN ('activate_emergency_mode', 'close_all_sessions'))
);

ALTER TABLE public.danger_action_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.danger_action_requests FORCE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.request_danger_action(
  _actor_id UUID,
  _action_type TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  request_id UUID;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _actor_id AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'insufficient_permissions' USING ERRCODE = '42501';
  END IF;

  IF _action_type NOT IN ('activate_emergency_mode', 'close_all_sessions') THEN
    RAISE EXCEPTION 'invalid_action_type' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.danger_action_requests (action_type, requested_by, status)
  VALUES (_action_type, _actor_id, 'pending')
  RETURNING id INTO request_id;

  PERFORM public.append_admin_audit_event(
    pg_catalog.gen_random_uuid(),
    _actor_id,
    NULL,
    'user.lifecycle.changed',
    'started',
    'DANGER_REQUESTED_' || pg_catalog.upper(_action_type),
    NULL
  );

  RETURN request_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_danger_action(
  _approver_id UUID,
  _request_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  req_action_type TEXT;
  req_requested_by UUID;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _approver_id AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'insufficient_permissions' USING ERRCODE = '42501';
  END IF;

  SELECT action_type, requested_by INTO req_action_type, req_requested_by
  FROM public.danger_action_requests
  WHERE id = _request_id AND status = 'pending';

  IF req_action_type IS NULL THEN
    RAISE EXCEPTION 'request_not_found_or_not_pending' USING ERRCODE = 'P0002';
  END IF;

  -- Vier-Augen-Prinzip: Requestor and Approver must be different users!
  IF req_requested_by = _approver_id THEN
    RAISE EXCEPTION 'self_approval_forbidden' USING ERRCODE = '42501';
  END IF;

  UPDATE public.danger_action_requests
  SET status = 'approved', approved_by = _approver_id, updated_at = pg_catalog.now()
  WHERE id = _request_id;

  PERFORM public.append_admin_audit_event(
    pg_catalog.gen_random_uuid(),
    _approver_id,
    NULL,
    'user.lifecycle.changed',
    'succeeded',
    'DANGER_APPROVED_' || pg_catalog.upper(req_action_type),
    NULL
  );

  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_danger_action(
  _rejecter_id UUID,
  _request_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  req_action_type TEXT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _rejecter_id AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'insufficient_permissions' USING ERRCODE = '42501';
  END IF;

  SELECT action_type INTO req_action_type
  FROM public.danger_action_requests
  WHERE id = _request_id AND status = 'pending';

  IF req_action_type IS NULL THEN
    RAISE EXCEPTION 'request_not_found_or_not_pending' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.danger_action_requests
  SET status = 'rejected', approved_by = _rejecter_id, updated_at = pg_catalog.now()
  WHERE id = _request_id;

  PERFORM public.append_admin_audit_event(
    pg_catalog.gen_random_uuid(),
    _rejecter_id,
    NULL,
    'user.lifecycle.changed',
    'denied',
    'DANGER_REJECTED_' || pg_catalog.upper(req_action_type),
    NULL
  );

  RETURN TRUE;
END;
$$;

-- RLS policies for danger action requests
CREATE POLICY "Admins can select danger requests"
    ON public.danger_action_requests FOR SELECT
    TO authenticated
    USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'));

CREATE POLICY "Admins can insert danger requests"
    ON public.danger_action_requests FOR INSERT
    TO authenticated
    WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'));

-- Privileges
GRANT EXECUTE ON FUNCTION public.admin_create_role(UUID, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_delete_role(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.request_danger_action(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.approve_danger_action(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.reject_danger_action(UUID, UUID) TO service_role;
