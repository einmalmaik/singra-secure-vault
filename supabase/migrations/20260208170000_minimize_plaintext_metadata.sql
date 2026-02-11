-- Minimize remaining plaintext metadata where app does not require plaintext.
-- This migration is intentionally opinionated and may overwrite legacy labels.

-- Future signups: do not mirror email into profiles.display_name,
-- and avoid plaintext default vault names.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (user_id, display_name)
    VALUES (NEW.id, NULL);

    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'user');

    INSERT INTO public.vaults (user_id, name, is_default)
    VALUES (NEW.id, 'Encrypted Vault', TRUE);

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Remove legacy profile plaintext not needed by current app flows.
UPDATE public.profiles
SET display_name = NULL,
    avatar_url = NULL
WHERE display_name IS NOT NULL
   OR avatar_url IS NOT NULL;

-- Remove legacy plaintext vault labels (current app only needs vault id/default flag).
UPDATE public.vaults
SET name = 'Encrypted Vault',
    description = NULL
WHERE name <> 'Encrypted Vault'
   OR description IS NOT NULL;

-- Remove category icon/color plaintext that is not yet encrypted by client migration.
UPDATE public.categories
SET icon = NULL
WHERE icon IS NOT NULL
  AND icon NOT LIKE 'enc:cat:v1:%';

UPDATE public.categories
SET color = NULL
WHERE color IS NOT NULL
  AND color NOT LIKE 'enc:cat:v1:%';

-- Encrypt tag metadata at rest (feature currently not used by UI, but keep values recoverable).
UPDATE public.tags
SET name = 'enc:tag:v1:' || encode(
        pgp_sym_encrypt(name, public.get_totp_encryption_key(), 'cipher-algo=aes256, compress-algo=1'::text),
        'base64'
    )
WHERE name IS NOT NULL
  AND name NOT LIKE 'enc:tag:v1:%';

UPDATE public.tags
SET color = 'enc:tag:v1:' || encode(
        pgp_sym_encrypt(color, public.get_totp_encryption_key(), 'cipher-algo=aes256, compress-algo=1'::text),
        'base64'
    )
WHERE color IS NOT NULL
  AND color NOT LIKE 'enc:tag:v1:%';
