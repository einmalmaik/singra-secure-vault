-- ============================================
-- Singra PW - Support System + SLA Tracking
-- ============================================

-- ============================================
-- 1) SUPPORT TABLES
-- ============================================

CREATE TABLE IF NOT EXISTS public.support_tickets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    requester_email TEXT,
    subject TEXT NOT NULL CHECK (char_length(subject) >= 3 AND char_length(subject) <= 160),
    category TEXT NOT NULL DEFAULT 'general'
        CHECK (category IN ('general', 'technical', 'billing', 'security', 'family', 'other')),
    status TEXT NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'in_progress', 'waiting_user', 'resolved', 'closed')),
    priority_reason TEXT NOT NULL DEFAULT 'free'
        CHECK (priority_reason IN ('free', 'premium', 'families_owner', 'families_member', 'self_hosted')),
    tier_snapshot TEXT NOT NULL DEFAULT 'free'
        CHECK (tier_snapshot IN ('free', 'premium', 'families', 'self_hosted')),
    is_priority BOOLEAN NOT NULL DEFAULT false,
    sla_hours INTEGER NOT NULL DEFAULT 72 CHECK (sla_hours > 0 AND sla_hours <= 720),
    sla_due_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT (NOW() + INTERVAL '72 hours'),
    first_response_at TIMESTAMP WITH TIME ZONE,
    first_response_minutes INTEGER CHECK (first_response_minutes >= 0),
    first_responded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    resolved_at TIMESTAMP WITH TIME ZONE,
    closed_at TIMESTAMP WITH TIME ZONE,
    last_message_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.support_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id UUID REFERENCES public.support_tickets(id) ON DELETE CASCADE NOT NULL,
    author_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    author_role TEXT NOT NULL CHECK (author_role IN ('user', 'support', 'system')),
    is_internal BOOLEAN NOT NULL DEFAULT false,
    body TEXT NOT NULL CHECK (char_length(body) >= 1 AND char_length(body) <= 5000),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.support_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id UUID REFERENCES public.support_tickets(id) ON DELETE CASCADE NOT NULL,
    actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    event_type TEXT NOT NULL,
    event_payload JSONB,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- ============================================
-- 2) INDEXES
-- ============================================

CREATE INDEX IF NOT EXISTS idx_support_tickets_user_id ON public.support_tickets(user_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON public.support_tickets(status);
CREATE INDEX IF NOT EXISTS idx_support_tickets_priority ON public.support_tickets(is_priority, sla_due_at);
CREATE INDEX IF NOT EXISTS idx_support_tickets_created_at ON public.support_tickets(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_tickets_last_message_at ON public.support_tickets(last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_tickets_first_response_at ON public.support_tickets(first_response_at);

CREATE INDEX IF NOT EXISTS idx_support_messages_ticket_id ON public.support_messages(ticket_id, created_at);
CREATE INDEX IF NOT EXISTS idx_support_messages_author_user_id ON public.support_messages(author_user_id);

CREATE INDEX IF NOT EXISTS idx_support_events_ticket_id ON public.support_events(ticket_id, created_at);

-- ============================================
-- 3) SLA ENTITLEMENT FUNCTION
-- ============================================

CREATE OR REPLACE FUNCTION public.get_support_sla_for_user(_user_id UUID)
RETURNS TABLE(
    priority_reason TEXT,
    tier_snapshot TEXT,
    sla_hours INTEGER,
    is_priority BOOLEAN
)
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
    -- Families owner: active/trialing families subscription on own account
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

    -- Families member: active membership in a family where owner has active/trialing families plan
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

    -- Premium
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

    -- Free default
    RETURN QUERY SELECT 'free', 'free', 72, false;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_support_sla_for_user(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_support_sla_for_user(UUID) TO service_role;

-- ============================================
-- 4) TRIGGER FUNCTIONS
-- ============================================

CREATE OR REPLACE FUNCTION public.support_ticket_before_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    ent RECORD;
BEGIN
    -- If user_id is absent, use auth.uid() for authenticated inserts.
    IF NEW.user_id IS NULL THEN
        NEW.user_id := auth.uid();
    END IF;

    -- Compute SLA from server-side entitlement logic.
    SELECT *
    INTO ent
    FROM public.get_support_sla_for_user(NEW.user_id)
    LIMIT 1;

    NEW.priority_reason := ent.priority_reason;
    NEW.tier_snapshot := ent.tier_snapshot;
    NEW.sla_hours := ent.sla_hours;
    NEW.is_priority := ent.is_priority;
    NEW.sla_due_at := COALESCE(NEW.created_at, NOW()) + make_interval(hours => ent.sla_hours);
    NEW.last_message_at := COALESCE(NEW.last_message_at, COALESCE(NEW.created_at, NOW()));

    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.support_message_after_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Maintain ticket recency + status flow
    UPDATE public.support_tickets
    SET
        last_message_at = NEW.created_at,
        status = CASE
            WHEN NEW.author_role = 'user' AND status = 'waiting_user' THEN 'open'
            WHEN NEW.author_role = 'support' AND status IN ('open', 'waiting_user') THEN 'in_progress'
            ELSE status
        END,
        updated_at = NOW()
    WHERE id = NEW.ticket_id;

    -- First response tracking (only non-internal support messages)
    IF NEW.author_role = 'support' AND NEW.is_internal = false THEN
        UPDATE public.support_tickets
        SET
            first_response_at = COALESCE(first_response_at, NEW.created_at),
            first_responded_by = COALESCE(first_responded_by, NEW.author_user_id),
            first_response_minutes = COALESCE(
                first_response_minutes,
                GREATEST(
                    FLOOR(EXTRACT(EPOCH FROM (NEW.created_at - created_at)) / 60)::INTEGER,
                    0
                )
            )
        WHERE id = NEW.ticket_id;
    END IF;

    -- Event log
    INSERT INTO public.support_events (ticket_id, actor_user_id, event_type, event_payload)
    VALUES (
        NEW.ticket_id,
        NEW.author_user_id,
        'message_created',
        jsonb_build_object(
            'author_role', NEW.author_role,
            'is_internal', NEW.is_internal
        )
    );

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_support_ticket_before_insert ON public.support_tickets;
CREATE TRIGGER trg_support_ticket_before_insert
    BEFORE INSERT ON public.support_tickets
    FOR EACH ROW EXECUTE FUNCTION public.support_ticket_before_insert();

DROP TRIGGER IF EXISTS trg_support_tickets_updated_at ON public.support_tickets;
CREATE TRIGGER trg_support_tickets_updated_at
    BEFORE UPDATE ON public.support_tickets
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_support_message_after_insert ON public.support_messages;
CREATE TRIGGER trg_support_message_after_insert
    AFTER INSERT ON public.support_messages
    FOR EACH ROW EXECUTE FUNCTION public.support_message_after_insert();

-- ============================================
-- 5) METRICS FUNCTION
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

    IF auth.uid() IS NULL OR (
        NOT public.has_role(auth.uid(), 'admin')
        AND NOT public.has_role(auth.uid(), 'moderator')
    ) THEN
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
-- 6) RLS
-- ============================================

ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_events ENABLE ROW LEVEL SECURITY;

-- support_tickets: users manage own tickets
DROP POLICY IF EXISTS "Users can view own support tickets" ON public.support_tickets;
CREATE POLICY "Users can view own support tickets"
    ON public.support_tickets FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can create own support tickets" ON public.support_tickets;
CREATE POLICY "Users can create own support tickets"
    ON public.support_tickets FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own support tickets" ON public.support_tickets;
CREATE POLICY "Users can update own support tickets"
    ON public.support_tickets FOR UPDATE
    TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- support_tickets: admin/moderator can manage all
DROP POLICY IF EXISTS "Support team can view all support tickets" ON public.support_tickets;
CREATE POLICY "Support team can view all support tickets"
    ON public.support_tickets FOR SELECT
    TO authenticated
    USING (
        public.has_role(auth.uid(), 'admin')
        OR public.has_role(auth.uid(), 'moderator')
    );

DROP POLICY IF EXISTS "Support team can manage all support tickets" ON public.support_tickets;
CREATE POLICY "Support team can manage all support tickets"
    ON public.support_tickets FOR ALL
    TO authenticated
    USING (
        public.has_role(auth.uid(), 'admin')
        OR public.has_role(auth.uid(), 'moderator')
    )
    WITH CHECK (
        public.has_role(auth.uid(), 'admin')
        OR public.has_role(auth.uid(), 'moderator')
    );

-- support_messages: users can read non-internal messages from own tickets
DROP POLICY IF EXISTS "Users can view own non-internal support messages" ON public.support_messages;
CREATE POLICY "Users can view own non-internal support messages"
    ON public.support_messages FOR SELECT
    TO authenticated
    USING (
        is_internal = false
        AND EXISTS (
            SELECT 1
            FROM public.support_tickets t
            WHERE t.id = support_messages.ticket_id
              AND t.user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "Users can write own support messages" ON public.support_messages;
CREATE POLICY "Users can write own support messages"
    ON public.support_messages FOR INSERT
    TO authenticated
    WITH CHECK (
        author_role = 'user'
        AND is_internal = false
        AND author_user_id = auth.uid()
        AND EXISTS (
            SELECT 1
            FROM public.support_tickets t
            WHERE t.id = support_messages.ticket_id
              AND t.user_id = auth.uid()
        )
    );

-- support_messages: admin/moderator can manage all messages
DROP POLICY IF EXISTS "Support team can manage support messages" ON public.support_messages;
CREATE POLICY "Support team can manage support messages"
    ON public.support_messages FOR ALL
    TO authenticated
    USING (
        public.has_role(auth.uid(), 'admin')
        OR public.has_role(auth.uid(), 'moderator')
    )
    WITH CHECK (
        public.has_role(auth.uid(), 'admin')
        OR public.has_role(auth.uid(), 'moderator')
    );

-- support_events: support team only
DROP POLICY IF EXISTS "Support team can view support events" ON public.support_events;
CREATE POLICY "Support team can view support events"
    ON public.support_events FOR SELECT
    TO authenticated
    USING (
        public.has_role(auth.uid(), 'admin')
        OR public.has_role(auth.uid(), 'moderator')
    );

DROP POLICY IF EXISTS "Support team can insert support events" ON public.support_events;
CREATE POLICY "Support team can insert support events"
    ON public.support_events FOR INSERT
    TO authenticated
    WITH CHECK (
        public.has_role(auth.uid(), 'admin')
        OR public.has_role(auth.uid(), 'moderator')
    );
