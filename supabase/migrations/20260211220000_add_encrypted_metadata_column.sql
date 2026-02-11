-- Add encrypted_metadata column to file_attachments.
-- This column stores AES-256-GCM encrypted JSON containing the real
-- file_name and mime_type. The existing plaintext columns are kept
-- for backward-compat but new uploads write opaque placeholders
-- ("encrypted" / "application/octet-stream") so a DB-level attacker
-- learns nothing about stored file types or names.

ALTER TABLE public.file_attachments
    ADD COLUMN IF NOT EXISTS encrypted_metadata TEXT;

COMMENT ON COLUMN public.file_attachments.encrypted_metadata IS
    'AES-256-GCM encrypted JSON {"file_name":"...","mime_type":"..."} — decrypted client-side with vault key';
