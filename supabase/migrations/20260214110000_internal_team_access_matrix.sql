-- ============================================
-- Internal Team Access Matrix (No-Code)
-- ============================================

-- ============================================
-- 1) Permission catalog + role mapping + audit log
-- ============================================

CREATE TABLE IF NOT EXISTS public.team_permissions (
    permission_key TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    description TEXT NOT NULL,
    category TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.role_permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    role app_role NOT NULL,
    permission_key TEXT NOT NULL REFERENCES public.team_permissions(permission_key) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE (role, permission_key)
);

CREATE TABLE IF NOT EXISTS public.team_access_audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    target_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    payload JSONB,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_role_permissions_role ON public.role_permissions(role);
CREATE INDEX IF NOT EXISTS idx_role_permissions_permission_key ON public.role_permissions(permission_key);
CREATE INDEX IF NOT EXISTS idx_team_access_audit_log_actor ON public.team_access_audit_log(actor_user_id);
CREATE INDEX IF NOT EXISTS idx_team_access_audit_log_target ON public.team_access_audit_log(target_user_id);
CREATE INDEX IF NOT EXISTS idx_team_access_audit_log_created_at ON public.team_access_audit_log(created_at DESC);

-- ============================================
-- 2) Seed permissions
-- ============================================

INSERT INTO public.team_permissions (permission_key, label, description, category)
VALUES
    ('support.admin.access', 'Support Admin Access', 'Access to the internal support admin area.', 'support'),
    ('support.tickets.read', 'Read Support Tickets', 'Read all support tickets and public ticket messages.', 'support'),
    ('support.tickets.reply', 'Reply to Support Tickets', 'Send support replies visible to users.', 'support'),
    ('support.tickets.reply_internal', 'Write Internal Notes', 'Write and view internal support notes.', 'support'),
    ('support.tickets.status', 'Update Ticket Status', 'Change support ticket workflow status.', 'support'),
    ('support.metrics.read', 'Read Support Metrics', 'Read support SLA metrics and response analytics.', 'support'),
    ('team.roles.read', 'Read Team Roles', 'View role assignments for internal team members.', 'team'),
    ('team.roles.manage', 'Manage Team Roles', 'Assign or remove internal team roles.', 'team'),
    ('team.permissions.read', 'Read Role Permissions', 'View permission matrix for roles.', 'team'),
    ('team.permissions.manage', 'Manage Role Permissions', 'Change permission matrix for roles.', 'team')
ON CONFLICT (permission_key) DO NOTHING;

-- ============================================
-- 3) Seed role-permission mapping
-- ============================================

INSERT INTO public.role_permissions (role, permission_key)
SELECT 'admin'::app_role, tp.permission_key
FROM public.team_permissions tp
ON CONFLICT (role, permission_key) DO NOTHING;

INSERT INTO public.role_permissions (role, permission_key)
SELECT 'moderator'::app_role, tp.permission_key
FROM public.team_permissions tp
WHERE tp.permission_key IN (
    'support.admin.access',
    'support.tickets.read',
    'support.tickets.reply',
    'support.tickets.reply_internal',
    'support.tickets.status',
    'support.metrics.read',
    'team.roles.read',
    'team.permissions.read'
)
ON CONFLICT (role, permission_key) DO NOTHING;

-- ============================================
-- 4) Permission helper functions
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

GRANT EXECUTE ON FUNCTION public.has_permission(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_permission(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_my_permissions() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_permissions() TO service_role;

-- ============================================
-- 5) Permission-aware support metrics function
-- ============================================

CREATE OR REPLACE FUNCTION public.get_support_response_metrics(_days INTEGER DEFAULT 30)
RETURNS TABLE(
    window_days INTEGER,
    segment TEXT,
    ticket_count BIGINT,
    responded_count BIGINT,
    avg_first_response_minutes NUMERIC,
    avg_first_response_hours NUMERIC,
    sla_hit_rate_percent NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF _days < 1 OR _days > 365 THEN
        RAISE EXCEPTION 'days must be between 1 and 365';
    END IF;

    IF auth.uid() IS NULL
       OR NOT public.has_permission(auth.uid(), 'support.metrics.read') THEN
        RAISE EXCEPTION 'insufficient privileges';
    END IF;

    RETURN QUERY
    WITH scoped AS (
        SELECT *
        FROM public.support_tickets
        WHERE created_at >= NOW() - make_interval(days => _days)
    ),
    grouped AS (
        SELECT
            'all'::TEXT AS segment,
            COUNT(*)::BIGINT AS ticket_count,
            COUNT(*) FILTER (WHERE first_response_at IS NOT NULL)::BIGINT AS responded_count,
            ROUND(AVG(first_response_minutes)::NUMERIC, 2) AS avg_minutes,
            ROUND((AVG(first_response_minutes) / 60.0)::NUMERIC, 2) AS avg_hours,
            ROUND(
                100.0 *
                (COUNT(*) FILTER (WHERE first_response_at IS NOT NULL AND first_response_at <= sla_due_at))::NUMERIC /
                NULLIF((COUNT(*) FILTER (WHERE first_response_at IS NOT NULL))::NUMERIC, 0),
                2
            ) AS sla_hit_rate
        FROM scoped

        UNION ALL

        SELECT
            priority_reason::TEXT AS segment,
            COUNT(*)::BIGINT AS ticket_count,
            COUNT(*) FILTER (WHERE first_response_at IS NOT NULL)::BIGINT AS responded_count,
            ROUND(AVG(first_response_minutes)::NUMERIC, 2) AS avg_minutes,
            ROUND((AVG(first_response_minutes) / 60.0)::NUMERIC, 2) AS avg_hours,
            ROUND(
                100.0 *
                (COUNT(*) FILTER (WHERE first_response_at IS NOT NULL AND first_response_at <= sla_due_at))::NUMERIC /
                NULLIF((COUNT(*) FILTER (WHERE first_response_at IS NOT NULL))::NUMERIC, 0),
                2
            ) AS sla_hit_rate
        FROM scoped
        GROUP BY priority_reason
    )
    SELECT
        _days AS window_days,
        grouped.segment,
        grouped.ticket_count,
        grouped.responded_count,
        COALESCE(grouped.avg_minutes, 0),
        COALESCE(grouped.avg_hours, 0),
        COALESCE(grouped.sla_hit_rate, 0)
    FROM grouped
    ORDER BY CASE WHEN grouped.segment = 'all' THEN 0 ELSE 1 END, grouped.segment;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_support_response_metrics(INTEGER) TO authenticated;

-- ============================================
-- 6) RLS policies for team access tables
-- ============================================

ALTER TABLE public.team_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_access_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Team permissions select" ON public.team_permissions;
CREATE POLICY "Team permissions select"
    ON public.team_permissions FOR SELECT
    TO authenticated
    USING (
        (SELECT public.has_permission((SELECT auth.uid()), 'team.permissions.read'))
        OR (SELECT public.has_permission((SELECT auth.uid()), 'team.permissions.manage'))
    );

DROP POLICY IF EXISTS "Team permissions manage" ON public.team_permissions;
CREATE POLICY "Team permissions manage"
    ON public.team_permissions FOR ALL
    TO authenticated
    USING ((SELECT public.has_permission((SELECT auth.uid()), 'team.permissions.manage')))
    WITH CHECK ((SELECT public.has_permission((SELECT auth.uid()), 'team.permissions.manage')));

DROP POLICY IF EXISTS "Role permissions select" ON public.role_permissions;
CREATE POLICY "Role permissions select"
    ON public.role_permissions FOR SELECT
    TO authenticated
    USING (
        (SELECT public.has_permission((SELECT auth.uid()), 'team.permissions.read'))
        OR (SELECT public.has_permission((SELECT auth.uid()), 'team.permissions.manage'))
    );

DROP POLICY IF EXISTS "Role permissions manage" ON public.role_permissions;
CREATE POLICY "Role permissions manage"
    ON public.role_permissions FOR ALL
    TO authenticated
    USING ((SELECT public.has_permission((SELECT auth.uid()), 'team.permissions.manage')))
    WITH CHECK ((SELECT public.has_permission((SELECT auth.uid()), 'team.permissions.manage')));

DROP POLICY IF EXISTS "Team access audit log select" ON public.team_access_audit_log;
CREATE POLICY "Team access audit log select"
    ON public.team_access_audit_log FOR SELECT
    TO authenticated
    USING (
        (SELECT public.has_permission((SELECT auth.uid()), 'team.roles.read'))
        OR (SELECT public.has_permission((SELECT auth.uid()), 'team.permissions.read'))
        OR (SELECT public.has_permission((SELECT auth.uid()), 'team.roles.manage'))
        OR (SELECT public.has_permission((SELECT auth.uid()), 'team.permissions.manage'))
    );

DROP POLICY IF EXISTS "Team access audit log insert" ON public.team_access_audit_log;
CREATE POLICY "Team access audit log insert"
    ON public.team_access_audit_log FOR INSERT
    TO authenticated
    WITH CHECK (
        (SELECT public.has_permission((SELECT auth.uid()), 'team.roles.manage'))
        OR (SELECT public.has_permission((SELECT auth.uid()), 'team.permissions.manage'))
    );

-- Extend existing user_roles access for internal team management.
DROP POLICY IF EXISTS "Team can view all roles" ON public.user_roles;
CREATE POLICY "Team can view all roles"
    ON public.user_roles FOR SELECT
    TO authenticated
    USING (
        (SELECT public.has_permission((SELECT auth.uid()), 'team.roles.read'))
        OR (SELECT public.has_permission((SELECT auth.uid()), 'team.roles.manage'))
    );

DROP POLICY IF EXISTS "Team can manage roles" ON public.user_roles;
CREATE POLICY "Team can manage roles"
    ON public.user_roles FOR ALL
    TO authenticated
    USING ((SELECT public.has_permission((SELECT auth.uid()), 'team.roles.manage')))
    WITH CHECK ((SELECT public.has_permission((SELECT auth.uid()), 'team.roles.manage')));
