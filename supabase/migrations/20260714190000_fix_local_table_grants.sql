-- Fix: Grant DML privileges on all public tables to standard Supabase roles.
--
-- The Supabase Cloud platform grants these automatically, but the local
-- CLI does not. Without them, the service_role JWT cannot pass the
-- PostgreSQL privilege check and gets "permission denied" before RLS
-- policies are even evaluated.

GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public
  TO postgres, anon, authenticated, service_role;

GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public
  TO postgres, anon, authenticated, service_role;

GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public
  TO postgres, anon, authenticated, service_role;

-- Ensure future tables inherit the same grants automatically.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES TO postgres, anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON SEQUENCES TO postgres, anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON FUNCTIONS TO postgres, anon, authenticated, service_role;
