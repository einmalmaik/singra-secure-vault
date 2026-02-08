-- icon_url is not required by the current UI and can expose website metadata in plaintext.
-- Clear existing values to minimize plaintext at rest.
UPDATE public.vault_items
SET icon_url = NULL
WHERE icon_url IS NOT NULL;
