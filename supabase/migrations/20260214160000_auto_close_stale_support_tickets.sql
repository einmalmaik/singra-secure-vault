-- Enable pg_cron for scheduled jobs
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

-- Grant usage to postgres role (required by Supabase)
GRANT USAGE ON SCHEMA cron TO postgres;

-- ============================================================
-- Function: auto_close_stale_support_tickets
-- Closes tickets that have been resolved/waiting_user without
-- user activity for a configurable period.
--
-- Rules:
--   resolved     → auto-close after 7 days
--   waiting_user → auto-close after 14 days
-- ============================================================
CREATE OR REPLACE FUNCTION public.auto_close_stale_support_tickets()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  closed_count integer;
BEGIN
  WITH stale_tickets AS (
    SELECT id
    FROM support_tickets
    WHERE status = 'resolved'
      AND resolved_at IS NOT NULL
      AND resolved_at < now() - interval '7 days'
      AND (closed_at IS NULL)

    UNION ALL

    SELECT id
    FROM support_tickets
    WHERE status = 'waiting_user'
      AND updated_at < now() - interval '14 days'
      AND (closed_at IS NULL)
  )
  UPDATE support_tickets t
  SET status = 'closed',
      closed_at = now(),
      updated_at = now()
  FROM stale_tickets s
  WHERE t.id = s.id;

  GET DIAGNOSTICS closed_count = ROW_COUNT;

  -- Insert a system message for each auto-closed ticket
  INSERT INTO support_messages (ticket_id, author_user_id, author_role, is_internal, body)
  SELECT t.id, t.user_id, 'system', false,
         'Ticket wurde automatisch geschlossen (keine Aktivitaet). / Ticket auto-closed due to inactivity.'
  FROM support_tickets t
  WHERE t.status = 'closed'
    AND t.closed_at >= now() - interval '1 minute'
    AND NOT EXISTS (
      SELECT 1 FROM support_messages m
      WHERE m.ticket_id = t.id
        AND m.author_role = 'system'
        AND m.body LIKE '%auto-closed%'
        AND m.created_at >= now() - interval '1 minute'
    );

  RETURN closed_count;
END;
$$;

COMMENT ON FUNCTION public.auto_close_stale_support_tickets IS
  'Automatically closes resolved (7d) and waiting_user (14d) tickets. Called daily by pg_cron.';

-- Schedule: run daily at 03:00 UTC
SELECT cron.schedule(
  'auto-close-stale-support-tickets',
  '0 3 * * *',
  $$SELECT public.auto_close_stale_support_tickets()$$
);
