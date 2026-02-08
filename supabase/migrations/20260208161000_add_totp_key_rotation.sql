-- Add secure key rotation for encrypted 2FA/TOTP secrets.
-- Rotates private.app_secrets('totp_encryption_key') and re-encrypts existing payloads.

CREATE OR REPLACE FUNCTION public.rotate_totp_encryption_key(
    p_new_key TEXT
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
    _old_key TEXT;
    _rotated_count INTEGER := 0;
BEGIN
    IF p_new_key IS NULL OR length(trim(p_new_key)) = 0 THEN
        RAISE EXCEPTION 'New key must not be empty';
    END IF;

    -- Expect 64-char hex key (32 random bytes encoded as hex).
    IF p_new_key !~ '^[0-9a-fA-F]{64}$' THEN
        RAISE EXCEPTION 'Invalid key format: expected 64 hex chars';
    END IF;

    SELECT value INTO _old_key
    FROM private.app_secrets
    WHERE name = 'totp_encryption_key'
    LIMIT 1;

    IF _old_key IS NULL THEN
        RAISE EXCEPTION 'Missing secret private.app_secrets(totp_encryption_key)';
    END IF;

    IF lower(_old_key) = lower(p_new_key) THEN
        RAISE EXCEPTION 'New key equals current key';
    END IF;

    -- Re-encrypt all encrypted secrets from old key to new key.
    UPDATE public.user_2fa
    SET totp_secret_enc = encode(
        pgp_sym_encrypt(
            pgp_sym_decrypt(decode(totp_secret_enc, 'base64'), _old_key),
            p_new_key,
            'cipher-algo=aes256, compress-algo=1'
        ),
        'base64'
    )
    WHERE totp_secret_enc IS NOT NULL;

    GET DIAGNOSTICS _rotated_count = ROW_COUNT;

    -- Optional fallback: if legacy plaintext rows still exist, encrypt with new key.
    UPDATE public.user_2fa
    SET totp_secret_enc = encode(
            pgp_sym_encrypt(totp_secret, p_new_key, 'cipher-algo=aes256, compress-algo=1'),
            'base64'
        ),
        totp_secret = NULL
    WHERE totp_secret IS NOT NULL
      AND totp_secret_enc IS NULL;

    -- Activate new key only after successful re-encryption.
    UPDATE private.app_secrets
    SET value = lower(p_new_key)
    WHERE name = 'totp_encryption_key';

    RETURN _rotated_count;
END;
$$;

REVOKE ALL ON FUNCTION public.rotate_totp_encryption_key(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rotate_totp_encryption_key(TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.rotate_totp_encryption_key(TEXT) FROM authenticated;
