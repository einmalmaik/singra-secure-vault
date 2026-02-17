-- Migration: Harden passkey PRF consistency
-- Ensures prf_enabled only indicates vault-unlock-capable credentials.

-- Backfill legacy rows that marked PRF as enabled without a wrapped key.
UPDATE public.passkey_credentials
SET prf_enabled = FALSE
WHERE prf_enabled = TRUE
  AND wrapped_master_key IS NULL;

-- Enforce consistency for future writes.
ALTER TABLE public.passkey_credentials
DROP CONSTRAINT IF EXISTS passkey_prf_requires_wrapped_key_check;

ALTER TABLE public.passkey_credentials
ADD CONSTRAINT passkey_prf_requires_wrapped_key_check
CHECK (prf_enabled = FALSE OR wrapped_master_key IS NOT NULL);
