-- ============================================
-- Harden SECURITY DEFINER RPC access control
-- ============================================

-- Ensure role checks are self-scoped for authenticated users.
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
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
          AND (
            auth.role() = 'service_role'
            OR _user_id = auth.uid()
          )
    )
$$;

-- Keep permission checks self-scoped while allowing service role.
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
          AND (
            auth.role() = 'service_role'
            OR _user_id = auth.uid()
          )
    );
$$;

-- Prevent membership oracle access for arbitrary user IDs.
CREATE OR REPLACE FUNCTION public.is_shared_collection_member(_collection_id UUID, _user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.shared_collection_members
        WHERE collection_id = _collection_id
          AND user_id = _user_id
          AND (
            auth.role() = 'service_role'
            OR _user_id = auth.uid()
          )
    );
$$;

-- Prevent paid-plan oracle access for arbitrary user IDs.
CREATE OR REPLACE FUNCTION public.user_has_active_paid_subscription(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.subscriptions s
        WHERE s.user_id = p_user_id
          AND s.tier IN ('premium', 'families')
          AND s.status IN ('active', 'trialing')
          AND (
            auth.role() = 'service_role'
            OR p_user_id = auth.uid()
          )
    );
$$;

-- Restrict SLA lookup to own user unless called by service role.
CREATE OR REPLACE FUNCTION public.get_support_sla_for_user(_user_id UUID)
RETURNS TABLE(priority_reason TEXT, tier_snapshot TEXT, sla_hours INTEGER, is_priority BOOLEAN)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    has_families_owner BOOLEAN := false;
    has_families_member BOOLEAN := false;
    has_premium BOOLEAN := false;
BEGIN
    IF auth.role() <> 'service_role'
       AND (auth.uid() IS NULL OR _user_id <> auth.uid()) THEN
        RAISE EXCEPTION 'insufficient privileges';
    END IF;

    SELECT EXISTS (
        SELECT 1
        FROM public.subscriptions s
        WHERE s.user_id = _user_id
          AND s.tier = 'families'
          AND s.status IN ('active', 'trialing')
    ) INTO has_families_owner;

    IF has_families_owner THEN
        RETURN QUERY SELECT 'families_owner', 'families', 24, true;
        RETURN;
    END IF;

    SELECT EXISTS (
        SELECT 1
        FROM public.family_members fm
        JOIN public.subscriptions s
          ON s.user_id = fm.family_owner_id
         AND s.tier = 'families'
         AND s.status IN ('active', 'trialing')
        WHERE fm.member_user_id = _user_id
          AND fm.status = 'active'
    ) INTO has_families_member;

    IF has_families_member THEN
        RETURN QUERY SELECT 'families_member', 'families', 24, true;
        RETURN;
    END IF;

    SELECT EXISTS (
        SELECT 1
        FROM public.subscriptions s
        WHERE s.user_id = _user_id
          AND s.tier = 'premium'
          AND s.status IN ('active', 'trialing')
    ) INTO has_premium;

    IF has_premium THEN
        RETURN QUERY SELECT 'premium', 'premium', 24, true;
        RETURN;
    END IF;

    RETURN QUERY SELECT 'free', 'free', 72, false;
END;
$$;

-- Remove broad execute grants (including PUBLIC/anon defaults).
REVOKE EXECUTE ON FUNCTION public.has_role(UUID, app_role) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.has_role(UUID, app_role) FROM anon;
GRANT EXECUTE ON FUNCTION public.has_role(UUID, app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(UUID, app_role) TO service_role;

REVOKE EXECUTE ON FUNCTION public.has_permission(UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.has_permission(UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.has_permission(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_permission(UUID, TEXT) TO service_role;

REVOKE EXECUTE ON FUNCTION public.get_my_permissions() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_my_permissions() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_my_permissions() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_permissions() TO service_role;

REVOKE EXECUTE ON FUNCTION public.get_support_response_metrics(INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_support_response_metrics(INTEGER) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_support_response_metrics(INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_support_response_metrics(INTEGER) TO service_role;

REVOKE EXECUTE ON FUNCTION public.get_support_sla_for_user(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_support_sla_for_user(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_support_sla_for_user(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_support_sla_for_user(UUID) TO service_role;

REVOKE EXECUTE ON FUNCTION public.is_shared_collection_member(UUID, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_shared_collection_member(UUID, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.is_shared_collection_member(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_shared_collection_member(UUID, UUID) TO service_role;

REVOKE EXECUTE ON FUNCTION public.user_has_active_paid_subscription(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.user_has_active_paid_subscription(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.user_has_active_paid_subscription(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_has_active_paid_subscription(UUID) TO service_role;
