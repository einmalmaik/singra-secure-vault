-- Add hash_version to backup_codes for backup code hashing migrations
ALTER TABLE public.backup_codes
ADD COLUMN IF NOT EXISTS hash_version INTEGER;

COMMENT ON COLUMN public.backup_codes.hash_version IS
'Version of the backup code hash format (NULL = legacy, 3 = Argon2id v3).';
