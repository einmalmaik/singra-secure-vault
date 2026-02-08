-- Ensure new vault items use non-plaintext metadata placeholders.
-- Decision date: 2026-02-08

ALTER TABLE public.vault_items
ALTER COLUMN title SET DEFAULT 'Encrypted Item';

-- Safety cleanup for already-migrated items: keep URL column empty.
UPDATE public.vault_items
SET website_url = NULL
WHERE title = 'Encrypted Item' AND website_url IS NOT NULL;
