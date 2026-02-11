-- Add kdf_version column to profiles for KDF parameter auto-migration.
--
-- Version 1: Argon2id 64 MiB, 3 iterations, parallelism 4 (current default)
-- Version 2: Argon2id 128 MiB, 3 iterations, parallelism 4 (OWASP 2025 enhanced)
--
-- All existing users default to version 1. After successful unlock the
-- client checks if an upgrade is available and transparently re-derives
-- the key with stronger parameters.

ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS kdf_version INTEGER NOT NULL DEFAULT 1;

COMMENT ON COLUMN public.profiles.kdf_version IS
    'KDF parameter version. 1 = Argon2id 64 MiB, 2 = Argon2id 128 MiB. Auto-migrated on unlock.';
