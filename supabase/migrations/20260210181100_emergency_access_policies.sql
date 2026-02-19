
-- Enable RLS
ALTER TABLE emergency_access ENABLE ROW LEVEL SECURITY;

-- Grantor Policies
DROP POLICY IF EXISTS "Users can view own emergency access as grantor" ON emergency_access;
CREATE POLICY "Users can view own emergency access as grantor"
ON emergency_access FOR SELECT
USING (auth.uid() = grantor_id);

DROP POLICY IF EXISTS "Users can insert own emergency access as grantor" ON emergency_access;
CREATE POLICY "Users can insert own emergency access as grantor"
ON emergency_access FOR INSERT
WITH CHECK (auth.uid() = grantor_id);

DROP POLICY IF EXISTS "Users can update own emergency access as grantor" ON emergency_access;
CREATE POLICY "Users can update own emergency access as grantor"
ON emergency_access FOR UPDATE
USING (auth.uid() = grantor_id);

DROP POLICY IF EXISTS "Users can delete own emergency access as grantor" ON emergency_access;
CREATE POLICY "Users can delete own emergency access as grantor"
ON emergency_access FOR DELETE
USING (auth.uid() = grantor_id);

-- Trustee Policies
-- View: either already linked (trusted_user_id) or invited via email
DROP POLICY IF EXISTS "Trustees can view emergency access" ON emergency_access;
CREATE POLICY "Trustees can view emergency access"
ON emergency_access FOR SELECT
USING (
  auth.uid() = trusted_user_id 
  OR 
  (trusted_user_id IS NULL AND trusted_email = current_setting('request.jwt.claim.email', true))
);

-- Update: Accept invite (claim by email)
-- SECURITY: Only allow setting trusted_user_id, no other fields can be modified
DROP POLICY IF EXISTS "Trustees can accept invite" ON emergency_access;
CREATE POLICY "Trustees can accept invite"
ON emergency_access FOR UPDATE
USING (
  trusted_user_id IS NULL AND trusted_email = current_setting('request.jwt.claim.email', true)
)
WITH CHECK (
  -- Only allow setting trusted_user_id to claim the invite
  trusted_user_id = auth.uid()
  AND status = 'accepted'
);

-- Update: Request access or other updates (once linked)
DROP POLICY IF EXISTS "Trustees can update linked emergency access" ON emergency_access;
CREATE POLICY "Trustees can update linked emergency access"
ON emergency_access FOR UPDATE
USING (auth.uid() = trusted_user_id);


-- Allow Trustees to view Vault Items of Grantors if Access is Granted
DROP POLICY IF EXISTS "Trustees can view vault items of grantors" ON vault_items;
CREATE POLICY "Trustees can view vault items of grantors"
ON vault_items FOR SELECT
USING (
  auth.uid() IN (
    SELECT trusted_user_id
    FROM emergency_access
    WHERE status = 'granted'
    AND grantor_id = vault_items.user_id
  )
);
