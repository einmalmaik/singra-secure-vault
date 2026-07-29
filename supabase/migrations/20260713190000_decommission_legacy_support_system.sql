-- Decommission the legacy Singra Vault support system without deleting history.
-- Ticket data stays retained and isolated until a separately approved retention review.

DELETE FROM public.role_permissions
WHERE permission_key LIKE 'support.%';

DELETE FROM public.team_permissions
WHERE permission_key LIKE 'support.%';

DO $$
BEGIN
  IF to_regclass('public.support_tickets') IS NOT NULL THEN
    ALTER TABLE public.support_tickets ALTER COLUMN user_id DROP NOT NULL;
    ALTER TABLE public.support_tickets DROP CONSTRAINT IF EXISTS support_tickets_user_id_fkey;
    ALTER TABLE public.support_tickets
      ADD CONSTRAINT support_tickets_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;
END
$$;

DO $$
DECLARE
  policy_row RECORD;
  support_table TEXT;
BEGIN
  FOREACH support_table IN ARRAY ARRAY['support_tickets', 'support_messages', 'support_events']
  LOOP
    IF to_regclass(format('public.%I', support_table)) IS NULL THEN
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', support_table);

    FOR policy_row IN
      SELECT policyname
      FROM pg_policies
      WHERE schemaname = 'public' AND tablename = support_table
    LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', policy_row.policyname, support_table);
    END LOOP;

    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM PUBLIC, anon, authenticated, service_role', support_table);
    EXECUTE format(
      'COMMENT ON TABLE public.%I IS %L',
      support_table,
      'Legacy support data retained in a deny-by-default state pending an approved retention and deletion process.'
    );
  END LOOP;
END
$$;

DO $$
DECLARE
  support_table TEXT;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    FOREACH support_table IN ARRAY ARRAY['support_tickets', 'support_messages', 'support_events']
    LOOP
      IF EXISTS (
        SELECT 1
        FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = support_table
      ) THEN
        EXECUTE format('ALTER PUBLICATION supabase_realtime DROP TABLE public.%I', support_table);
      END IF;
    END LOOP;
  END IF;
END
$$;

DO $$
BEGIN
  IF to_regclass('cron.job') IS NOT NULL AND EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'auto-close-stale-support-tickets'
  ) THEN
    PERFORM cron.unschedule('auto-close-stale-support-tickets');
  END IF;
END
$$;

DROP FUNCTION IF EXISTS public.auto_close_stale_support_tickets();
DROP FUNCTION IF EXISTS public.get_support_response_metrics(INTEGER);

