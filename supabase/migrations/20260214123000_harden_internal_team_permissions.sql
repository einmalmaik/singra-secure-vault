-- ============================================
-- Harden internal-team permission boundaries
-- ============================================

-- Ensure end-user role never receives internal admin permissions.
DELETE FROM public.role_permissions
WHERE role = 'user';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'role_permissions_internal_roles_only'
    ) THEN
        ALTER TABLE public.role_permissions
            ADD CONSTRAINT role_permissions_internal_roles_only
            CHECK (role IN ('admin', 'moderator'));
    END IF;
END;
$$;

-- Permission catalog is managed in migrations, not from runtime clients.
DROP POLICY IF EXISTS "Team permissions manage" ON public.team_permissions;

-- Restrict role-permission writes to internal roles only.
DROP POLICY IF EXISTS "Role permissions manage" ON public.role_permissions;
DROP POLICY IF EXISTS "Role permissions insert" ON public.role_permissions;
DROP POLICY IF EXISTS "Role permissions update" ON public.role_permissions;
DROP POLICY IF EXISTS "Role permissions delete" ON public.role_permissions;

CREATE POLICY "Role permissions insert"
    ON public.role_permissions FOR INSERT
    TO authenticated
    WITH CHECK (
        (SELECT public.has_permission((SELECT auth.uid()), 'team.permissions.manage'))
        AND role IN ('admin', 'moderator')
    );

CREATE POLICY "Role permissions update"
    ON public.role_permissions FOR UPDATE
    TO authenticated
    USING (
        (SELECT public.has_permission((SELECT auth.uid()), 'team.permissions.manage'))
        AND role IN ('admin', 'moderator')
    )
    WITH CHECK (
        (SELECT public.has_permission((SELECT auth.uid()), 'team.permissions.manage'))
        AND role IN ('admin', 'moderator')
    );

CREATE POLICY "Role permissions delete"
    ON public.role_permissions FOR DELETE
    TO authenticated
    USING (
        (SELECT public.has_permission((SELECT auth.uid()), 'team.permissions.manage'))
        AND role IN ('admin', 'moderator')
    );

-- Team role visibility and edits are internal-only (admin/moderator rows).
DROP POLICY IF EXISTS "Team can view all roles" ON public.user_roles;
DROP POLICY IF EXISTS "Team can manage roles" ON public.user_roles;
DROP POLICY IF EXISTS "Team can insert internal roles" ON public.user_roles;
DROP POLICY IF EXISTS "Team can delete internal roles" ON public.user_roles;

CREATE POLICY "Team can view internal roles"
    ON public.user_roles FOR SELECT
    TO authenticated
    USING (
        role IN ('admin', 'moderator')
        AND (
            (SELECT public.has_permission((SELECT auth.uid()), 'team.roles.read'))
            OR (SELECT public.has_permission((SELECT auth.uid()), 'team.roles.manage'))
        )
    );

CREATE POLICY "Team can insert internal roles"
    ON public.user_roles FOR INSERT
    TO authenticated
    WITH CHECK (
        (SELECT public.has_permission((SELECT auth.uid()), 'team.roles.manage'))
        AND role IN ('admin', 'moderator')
    );

CREATE POLICY "Team can delete internal roles"
    ON public.user_roles FOR DELETE
    TO authenticated
    USING (
        (SELECT public.has_permission((SELECT auth.uid()), 'team.roles.manage'))
        AND role IN ('admin', 'moderator')
    );
