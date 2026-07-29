-- Keep TOTP crypto helpers independent of the caller search_path.
-- pgcrypto is installed in the protected extensions schema by Supabase.
CREATE OR REPLACE FUNCTION public.user_2fa_encrypt_secret(_secret TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    _key TEXT := public.get_totp_encryption_key();
BEGIN
    RETURN pg_catalog.encode(
        extensions.pgp_sym_encrypt(
            _secret,
            _key,
            'cipher-algo=aes256, compress-algo=1'::text
        ),
        'base64'
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.user_2fa_decrypt_secret(_secret_enc TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    _key TEXT := public.get_totp_encryption_key();
BEGIN
    RETURN extensions.pgp_sym_decrypt(
        pg_catalog.decode(_secret_enc, 'base64'),
        _key
    );
END;
$$;

REVOKE ALL ON FUNCTION public.user_2fa_encrypt_secret(TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.user_2fa_decrypt_secret(TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.user_2fa_encrypt_secret(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.user_2fa_decrypt_secret(TEXT) TO service_role;

COMMENT ON FUNCTION public.user_2fa_encrypt_secret(TEXT) IS
  'Service-only TOTP encryption helper using the Supabase pgcrypto extension.';
COMMENT ON FUNCTION public.user_2fa_decrypt_secret(TEXT) IS
  'Service-only TOTP decryption helper using the Supabase pgcrypto extension.';
