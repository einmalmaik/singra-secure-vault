-- ============================================
-- Support System Policy/Index Optimizations
-- ============================================

-- ============================================
-- 1) FK INDEXES RECOMMENDED BY ADVISOR
-- ============================================

CREATE INDEX IF NOT EXISTS idx_support_tickets_first_responded_by
    ON public.support_tickets(first_responded_by);

CREATE INDEX IF NOT EXISTS idx_support_events_actor_user_id
    ON public.support_events(actor_user_id);

-- ============================================
-- 2) CONSOLIDATE RLS POLICIES + INITPLAN-SAFE AUTH CALLS
-- ============================================

-- support_tickets
DROP POLICY IF EXISTS "Users can view own support tickets" ON public.support_tickets;
DROP POLICY IF EXISTS "Users can create own support tickets" ON public.support_tickets;
DROP POLICY IF EXISTS "Users can update own support tickets" ON public.support_tickets;
DROP POLICY IF EXISTS "Support team can view all support tickets" ON public.support_tickets;
DROP POLICY IF EXISTS "Support team can manage all support tickets" ON public.support_tickets;

CREATE POLICY "Support tickets select"
    ON public.support_tickets FOR SELECT
    TO authenticated
    USING (
        (SELECT auth.uid()) = user_id
        OR (
            (SELECT public.has_role((SELECT auth.uid()), 'admin'))
            OR (SELECT public.has_role((SELECT auth.uid()), 'moderator'))
        )
    );

CREATE POLICY "Support tickets insert"
    ON public.support_tickets FOR INSERT
    TO authenticated
    WITH CHECK (
        (SELECT auth.uid()) = user_id
        OR (
            (SELECT public.has_role((SELECT auth.uid()), 'admin'))
            OR (SELECT public.has_role((SELECT auth.uid()), 'moderator'))
        )
    );

CREATE POLICY "Support tickets update"
    ON public.support_tickets FOR UPDATE
    TO authenticated
    USING (
        (SELECT auth.uid()) = user_id
        OR (
            (SELECT public.has_role((SELECT auth.uid()), 'admin'))
            OR (SELECT public.has_role((SELECT auth.uid()), 'moderator'))
        )
    )
    WITH CHECK (
        (SELECT auth.uid()) = user_id
        OR (
            (SELECT public.has_role((SELECT auth.uid()), 'admin'))
            OR (SELECT public.has_role((SELECT auth.uid()), 'moderator'))
        )
    );

CREATE POLICY "Support tickets delete"
    ON public.support_tickets FOR DELETE
    TO authenticated
    USING (
        (SELECT public.has_role((SELECT auth.uid()), 'admin'))
        OR (SELECT public.has_role((SELECT auth.uid()), 'moderator'))
    );

-- support_messages
DROP POLICY IF EXISTS "Users can view own non-internal support messages" ON public.support_messages;
DROP POLICY IF EXISTS "Users can write own support messages" ON public.support_messages;
DROP POLICY IF EXISTS "Support team can manage support messages" ON public.support_messages;

CREATE POLICY "Support messages select"
    ON public.support_messages FOR SELECT
    TO authenticated
    USING (
        (
            is_internal = false
            AND EXISTS (
                SELECT 1
                FROM public.support_tickets t
                WHERE t.id = support_messages.ticket_id
                  AND t.user_id = (SELECT auth.uid())
            )
        )
        OR (
            (SELECT public.has_role((SELECT auth.uid()), 'admin'))
            OR (SELECT public.has_role((SELECT auth.uid()), 'moderator'))
        )
    );

CREATE POLICY "Support messages insert"
    ON public.support_messages FOR INSERT
    TO authenticated
    WITH CHECK (
        (
            author_role = 'user'
            AND is_internal = false
            AND author_user_id = (SELECT auth.uid())
            AND EXISTS (
                SELECT 1
                FROM public.support_tickets t
                WHERE t.id = support_messages.ticket_id
                  AND t.user_id = (SELECT auth.uid())
            )
        )
        OR (
            (SELECT public.has_role((SELECT auth.uid()), 'admin'))
            OR (SELECT public.has_role((SELECT auth.uid()), 'moderator'))
        )
    );

CREATE POLICY "Support messages update"
    ON public.support_messages FOR UPDATE
    TO authenticated
    USING (
        (SELECT public.has_role((SELECT auth.uid()), 'admin'))
        OR (SELECT public.has_role((SELECT auth.uid()), 'moderator'))
    )
    WITH CHECK (
        (SELECT public.has_role((SELECT auth.uid()), 'admin'))
        OR (SELECT public.has_role((SELECT auth.uid()), 'moderator'))
    );

CREATE POLICY "Support messages delete"
    ON public.support_messages FOR DELETE
    TO authenticated
    USING (
        (SELECT public.has_role((SELECT auth.uid()), 'admin'))
        OR (SELECT public.has_role((SELECT auth.uid()), 'moderator'))
    );

-- support_events
DROP POLICY IF EXISTS "Support team can view support events" ON public.support_events;
DROP POLICY IF EXISTS "Support team can insert support events" ON public.support_events;

CREATE POLICY "Support events select"
    ON public.support_events FOR SELECT
    TO authenticated
    USING (
        (SELECT public.has_role((SELECT auth.uid()), 'admin'))
        OR (SELECT public.has_role((SELECT auth.uid()), 'moderator'))
    );

CREATE POLICY "Support events insert"
    ON public.support_events FOR INSERT
    TO authenticated
    WITH CHECK (
        (SELECT public.has_role((SELECT auth.uid()), 'admin'))
        OR (SELECT public.has_role((SELECT auth.uid()), 'moderator'))
    );
