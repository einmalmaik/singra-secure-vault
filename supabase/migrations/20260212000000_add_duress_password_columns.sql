-- Migration: Add Duress (Panic) Password columns to profiles
-- Phase 5.2: Duress/Panic Password feature
-- Created: 2026-02-12

-- ============================================================
-- Add Duress Password Columns
-- ============================================================

-- Note: Using intentionally vague column comments for plausible deniability.
-- An attacker examining the schema should not immediately recognize
-- these as "panic password" columns.

ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS duress_salt TEXT,
ADD COLUMN IF NOT EXISTS duress_password_verifier TEXT,
ADD COLUMN IF NOT EXISTS duress_kdf_version INTEGER;

-- Vague comments that don't reveal the true purpose
COMMENT ON COLUMN public.profiles.duress_salt IS 'Optional secondary encryption salt';
COMMENT ON COLUMN public.profiles.duress_password_verifier IS 'Optional secondary password verifier';
COMMENT ON COLUMN public.profiles.duress_kdf_version IS 'KDF version for secondary password';
