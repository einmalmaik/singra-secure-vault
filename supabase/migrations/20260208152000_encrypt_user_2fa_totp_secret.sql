-- Encrypt TOTP secrets at rest in user_2fa.
-- Supabase-safe key storage via private.app_secrets table.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS private;

CREATE TABLE IF NOT EXISTS private.app_secrets (
    name TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

REVOKE ALL ON SCHEMA private FROM PUBLIC;
REVOKE ALL ON SCHEMA private FROM anon;
REVOKE ALL ON SCHEMA private FROM authenticated;

REVOKE ALL ON TABLE private.app_secrets FROM PUBLIC;
REVOKE ALL ON TABLE private.app_secrets FROM anon;
REVOKE ALL ON TABLE private.app_secrets FROM authenticated;

CREATE OR REPLACE FUNCTION public.get_totp_encryption_key()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
    _key TEXT;
BEGIN
    SELECT value INTO _key
    FROM private.app_secrets
    WHERE name = 'totp_encryption_key'
    LIMIT 1;

    IF _key IS NULL THEN
        RAISE EXCEPTION 'Missing secret private.app_secrets(totp_encryption_key)';
    END IF;

    RETURN _key;
END;
$$;

ALTER TABLE public.user_2fa
ADD COLUMN IF NOT EXISTS totp_secret_enc TEXT;

ALTER TABLE public.user_2fa
ALTER COLUMN totp_secret DROP NOT NULL;

CREATE OR REPLACE FUNCTION public.user_2fa_encrypt_secret(_secret TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    _key TEXT := public.get_totp_encryption_key();
BEGIN
    RETURN encode(
        pgp_sym_encrypt(_secret, _key, 'cipher-algo=aes256, compress-algo=1'),
        'base64'
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.user_2fa_decrypt_secret(_secret_enc TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    _key TEXT := public.get_totp_encryption_key();
BEGIN
    RETURN pgp_sym_decrypt(
        decode(_secret_enc, 'base64'),
        _key
    );
END;
$$;

UPDATE public.user_2fa
SET totp_secret_enc = public.user_2fa_encrypt_secret(totp_secret)
WHERE totp_secret IS NOT NULL
  AND totp_secret_enc IS NULL;

UPDATE public.user_2fa
SET totp_secret = NULL
WHERE totp_secret_enc IS NOT NULL;

CREATE OR REPLACE FUNCTION public.initialize_user_2fa_secret(
    p_user_id UUID,
    p_secret TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    _uid UUID := auth.uid();
BEGIN
    IF _uid IS NULL OR _uid <> p_user_id THEN
        RAISE EXCEPTION 'Forbidden';
    END IF;

    DELETE FROM public.user_2fa
    WHERE user_id = p_user_id
      AND COALESCE(is_enabled, false) = false;

    INSERT INTO public.user_2fa (
        user_id,
        totp_secret,
        totp_secret_enc,
        is_enabled
    )
    VALUES (
        p_user_id,
        NULL,
        public.user_2fa_encrypt_secret(p_secret),
        false
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_user_2fa_secret(
    p_user_id UUID,
    p_require_enabled BOOLEAN DEFAULT true
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    _uid UUID := auth.uid();
    _secret_enc TEXT;
    _legacy_secret TEXT;
    _is_enabled BOOLEAN;
BEGIN
    IF _uid IS NULL OR _uid <> p_user_id THEN
        RAISE EXCEPTION 'Forbidden';
    END IF;

    SELECT totp_secret_enc, totp_secret, COALESCE(is_enabled, false)
    INTO _secret_enc, _legacy_secret, _is_enabled
    FROM public.user_2fa
    WHERE user_id = p_user_id
    LIMIT 1;

    IF _secret_enc IS NULL AND _legacy_secret IS NULL THEN
        RETURN NULL;
    END IF;

    IF p_require_enabled AND NOT _is_enabled THEN
        RETURN NULL;
    END IF;

    IF _secret_enc IS NOT NULL THEN
        RETURN public.user_2fa_decrypt_secret(_secret_enc);
    END IF;

    -- One-time fallback migration from plaintext.
    UPDATE public.user_2fa
    SET totp_secret_enc = public.user_2fa_encrypt_secret(_legacy_secret),
        totp_secret = NULL
    WHERE user_id = p_user_id;

    RETURN _legacy_secret;
END;
$$;

REVOKE ALL ON FUNCTION public.user_2fa_encrypt_secret(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.user_2fa_decrypt_secret(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_totp_encryption_key() FROM PUBLIC;

REVOKE ALL ON FUNCTION public.initialize_user_2fa_secret(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_user_2fa_secret(UUID, BOOLEAN) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.initialize_user_2fa_secret(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_2fa_secret(UUID, BOOLEAN) TO authenticated;
