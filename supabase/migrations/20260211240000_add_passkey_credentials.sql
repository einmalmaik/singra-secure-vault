-- Migration: Add Passkey/WebAuthn tables
-- Phase 4.1: WebAuthn/FIDO2 as additional unlock factor
-- Created: 2026-02-11

-- ============================================================
-- Passkey Credentials Table
-- ============================================================

CREATE TABLE IF NOT EXISTS public.passkey_credentials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    credential_id TEXT NOT NULL UNIQUE CHECK (credential_id <> ''),
    public_key TEXT NOT NULL CHECK (public_key <> ''),
    counter BIGINT NOT NULL DEFAULT 0,
    transports TEXT[] DEFAULT '{}',
    device_name TEXT NOT NULL DEFAULT 'Passkey',
    aaguid TEXT,
    -- PRF (Pseudo-Random Function) extension support
    prf_salt TEXT, -- Base64url-encoded 32-byte salt for PRF
    wrapped_master_key TEXT, -- AES-GCM encrypted raw key bytes (IV || ciphertext || tag)
    prf_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at TIMESTAMPTZ
);

-- Index for faster lookups by user
CREATE INDEX IF NOT EXISTS idx_passkey_credentials_user_id ON public.passkey_credentials(user_id);

-- ============================================================
-- WebAuthn Challenges Table (short-lived, 5 min TTL)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.webauthn_challenges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    challenge TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('registration', 'authentication')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '5 minutes')
);

-- Index for cleanup job
CREATE INDEX IF NOT EXISTS idx_webauthn_challenges_expires_at ON public.webauthn_challenges(expires_at);

-- ============================================================
-- Row Level Security
-- ============================================================

ALTER TABLE public.passkey_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webauthn_challenges ENABLE ROW LEVEL SECURITY;

-- Passkey credentials: users can only access their own
DROP POLICY IF EXISTS "Users can read own passkey_credentials" ON public.passkey_credentials;
CREATE POLICY "Users can read own passkey_credentials"
    ON public.passkey_credentials FOR SELECT
    TO authenticated
    USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can insert own passkey_credentials" ON public.passkey_credentials;
CREATE POLICY "Users can insert own passkey_credentials"
    ON public.passkey_credentials FOR INSERT
    TO authenticated
    WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can update own passkey_credentials" ON public.passkey_credentials;
CREATE POLICY "Users can update own passkey_credentials"
    ON public.passkey_credentials FOR UPDATE
    TO authenticated
    USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can delete own passkey_credentials" ON public.passkey_credentials;
CREATE POLICY "Users can delete own passkey_credentials"
    ON public.passkey_credentials FOR DELETE
    TO authenticated
    USING (user_id = auth.uid());

-- Challenges: users can only access their own
DROP POLICY IF EXISTS "Users can manage own webauthn_challenges" ON public.webauthn_challenges;
CREATE POLICY "Users can manage own webauthn_challenges"
    ON public.webauthn_challenges FOR ALL
    TO authenticated
    USING (user_id = auth.uid());

-- ============================================================
-- Cleanup Function for Expired Challenges
-- ============================================================

CREATE OR REPLACE FUNCTION cleanup_expired_webauthn_challenges()
RETURNS void AS $$
BEGIN
    DELETE FROM public.webauthn_challenges WHERE expires_at < now();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON TABLE public.passkey_credentials IS 'WebAuthn/FIDO2 passkey credentials with optional PRF support for vault unlock';
COMMENT ON TABLE public.webauthn_challenges IS 'Short-lived WebAuthn challenges (5 min TTL)';
