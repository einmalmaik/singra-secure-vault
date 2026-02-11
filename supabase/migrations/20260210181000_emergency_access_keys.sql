
-- Add columns to emergency_access for asymmetric encryption keys
ALTER TABLE emergency_access
ADD COLUMN IF NOT EXISTS trustee_public_key text,
ADD COLUMN IF NOT EXISTS encrypted_master_key text;

-- Add comment
COMMENT ON COLUMN emergency_access.trustee_public_key IS 'RSA-OAEP public key of the trustee (JWK JSON string)';
COMMENT ON COLUMN emergency_access.encrypted_master_key IS 'Grantor master key encrypted with Trustee public key';
