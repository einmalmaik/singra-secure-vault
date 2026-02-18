-- ============================================
-- Security hardening: ensure subscriptions RLS is enabled
-- ============================================

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'subscriptions'
      AND policyname = 'Users can view own subscription'
  ) THEN
    RAISE EXCEPTION 'Missing policy: Users can view own subscription';
  END IF;
END $$;
