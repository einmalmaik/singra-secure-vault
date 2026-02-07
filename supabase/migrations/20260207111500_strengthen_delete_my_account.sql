-- ============================================
-- Strengthen self-service account deletion
-- Ensures app tables and auth.users are removed atomically.
-- ============================================

DROP FUNCTION IF EXISTS public.delete_my_account();

CREATE OR REPLACE FUNCTION public.delete_my_account()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    _uid UUID := auth.uid();
    _deleted_auth_rows INTEGER := 0;
BEGIN
    IF _uid IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    -- Explicit cleanup first (defensive), then auth deletion.
    DELETE FROM public.vault_item_tags
    WHERE vault_item_id IN (
        SELECT id FROM public.vault_items WHERE user_id = _uid
    );

    DELETE FROM public.vault_items WHERE user_id = _uid;
    DELETE FROM public.categories WHERE user_id = _uid;
    DELETE FROM public.tags WHERE user_id = _uid;
    DELETE FROM public.vaults WHERE user_id = _uid;
    DELETE FROM public.user_roles WHERE user_id = _uid;
    DELETE FROM public.profiles WHERE user_id = _uid;

    DELETE FROM auth.users WHERE id = _uid;
    GET DIAGNOSTICS _deleted_auth_rows = ROW_COUNT;

    IF _deleted_auth_rows = 0 THEN
        RAISE EXCEPTION 'Auth user deletion failed';
    END IF;

    RETURN jsonb_build_object('deleted', true, 'user_id', _uid);
END;
$$;

REVOKE ALL ON FUNCTION public.delete_my_account() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_my_account() TO authenticated;
