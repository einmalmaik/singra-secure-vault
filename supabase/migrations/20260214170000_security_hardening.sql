-- ============================================
-- Security hardening: restrict has_permission & add rate limiting
-- ============================================

-- Fix #5: Restrict has_permission() to only check the calling user's own permissions.
-- Previously any authenticated user could probe other users' permissions.
CREATE OR REPLACE FUNCTION public.has_permission(_user_id UUID, _permission_key TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.user_roles ur
        JOIN public.role_permissions rp ON rp.role = ur.role
        WHERE ur.user_id = _user_id
          AND rp.permission_key = _permission_key
          AND _user_id = auth.uid()  -- Only allow checking own permissions
    );
$$;

-- Fix #8: Rate-limit support ticket creation per user (max 10 open tickets)
-- This prevents ticket-spam by checking count before insert via RLS.
DROP POLICY IF EXISTS "Support tickets insert" ON public.support_tickets;

CREATE POLICY "Support tickets insert"
    ON public.support_tickets FOR INSERT
    TO authenticated
    WITH CHECK (
        (
            (SELECT auth.uid()) = user_id
            AND (
                SELECT count(*) FROM public.support_tickets st
                WHERE st.user_id = (SELECT auth.uid())
                  AND st.status NOT IN ('closed')
            ) < 10
        )
        OR (
            (SELECT public.has_role((SELECT auth.uid()), 'admin'))
            OR (SELECT public.has_role((SELECT auth.uid()), 'moderator'))
        )
    );

-- Fix #8b: Rate-limit support messages per ticket (max 50 open messages per ticket per user per day)
-- Prevents message-spam on individual tickets.
CREATE OR REPLACE FUNCTION public.check_message_rate_limit()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    msg_count INT;
BEGIN
    -- Only rate-limit regular users, not admins/moderators
    IF EXISTS (
        SELECT 1 FROM public.user_roles ur
        WHERE ur.user_id = NEW.author_user_id
          AND ur.role IN ('admin', 'moderator')
    ) THEN
        RETURN NEW;
    END IF;

    SELECT count(*) INTO msg_count
    FROM public.support_messages
    WHERE ticket_id = NEW.ticket_id
      AND author_user_id = NEW.author_user_id
      AND created_at > NOW() - INTERVAL '24 hours';

    IF msg_count >= 50 THEN
        RAISE EXCEPTION 'Message rate limit exceeded (max 50 messages per ticket per 24h)';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_message_rate_limit ON public.support_messages;
CREATE TRIGGER trg_check_message_rate_limit
    BEFORE INSERT ON public.support_messages
    FOR EACH ROW
    EXECUTE FUNCTION public.check_message_rate_limit();

-- Fix #9: Add PII read permission for email visibility control
INSERT INTO public.team_permissions (permission_key, label, description, category)
VALUES ('support.pii.read', 'Read PII Data', 'View unmasked personal data (e.g. email addresses) in support tickets', 'support')
ON CONFLICT (permission_key) DO NOTHING;

-- Grant PII access to admin role by default (moderators must be explicitly granted)
INSERT INTO public.role_permissions (role, permission_key)
VALUES ('admin', 'support.pii.read')
ON CONFLICT DO NOTHING;
