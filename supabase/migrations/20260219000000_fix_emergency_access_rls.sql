-- ============================================================================
-- CRITICAL SECURITY FIX: Emergency Access RLS Policy Hardening
-- ============================================================================
-- Problem: The "Trustees can accept invite" policy only restricts trusted_user_id
-- but allows manipulation of other critical fields like status, expires_at, permissions
--
-- Solution: Enforce that ONLY trusted_user_id can be set when accepting an invite,
-- all other fields must remain unchanged
-- ============================================================================

-- Drop the vulnerable policy
DROP POLICY IF EXISTS "Trustees can accept invite" ON emergency_access;

-- Create hardened policy that prevents field manipulation
CREATE POLICY "Trustees can accept invite - hardened"
ON emergency_access FOR UPDATE
USING (
  -- Can only update if: invite is unclaimed AND email matches current user
  trusted_user_id IS NULL
  AND trusted_email = current_setting('request.jwt.claim.email', true)
)
WITH CHECK (
  -- CRITICAL: Only allow setting trusted_user_id to claim the invite
  trusted_user_id = auth.uid()

  -- CRITICAL: Ensure ALL other fields remain EXACTLY as they were
  -- This prevents manipulation of status, permissions, or timing fields
  AND status = OLD.status
  AND grantor_id = OLD.grantor_id
  AND trusted_email = OLD.trusted_email
  AND cooldown_hours = OLD.cooldown_hours
  AND encrypted_master_key IS NOT DISTINCT FROM OLD.encrypted_master_key
  AND pq_encrypted_master_key IS NOT DISTINCT FROM OLD.pq_encrypted_master_key
  AND requested_at IS NOT DISTINCT FROM OLD.requested_at
  AND granted_at IS NOT DISTINCT FROM OLD.granted_at
  AND expires_at IS NOT DISTINCT FROM OLD.expires_at
  AND permissions IS NOT DISTINCT FROM OLD.permissions
  AND created_at = OLD.created_at
  -- updated_at will change automatically via trigger, that's expected
);

-- Add explicit comment documenting the security requirements
COMMENT ON POLICY "Trustees can accept invite - hardened" ON emergency_access IS
'SECURITY: This policy allows trustees to claim an invite by setting ONLY their user_id.
ALL other fields must remain unchanged to prevent privilege escalation or status manipulation.
Any attempt to modify other fields will be rejected.';

-- ============================================================================
-- Additional Protection: Create audit trigger for emergency_access changes
-- ============================================================================

-- Create audit log table if it doesn't exist
CREATE TABLE IF NOT EXISTS emergency_access_audit (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  action TEXT NOT NULL,
  emergency_access_id UUID NOT NULL,
  user_id UUID,
  changed_fields JSONB,
  old_values JSONB,
  new_values JSONB,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS on audit table
ALTER TABLE emergency_access_audit ENABLE ROW LEVEL SECURITY;

-- Only system can insert, users can read their own audit logs
CREATE POLICY "Users can view own emergency access audit logs"
ON emergency_access_audit FOR SELECT
USING (
  user_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM emergency_access
    WHERE id = emergency_access_audit.emergency_access_id
    AND (grantor_id = auth.uid() OR trusted_user_id = auth.uid())
  )
);

-- Create trigger function to audit changes
CREATE OR REPLACE FUNCTION audit_emergency_access_changes()
RETURNS TRIGGER AS $$
DECLARE
  changed_fields JSONB := '{}';
  old_values JSONB := '{}';
  new_values JSONB := '{}';
BEGIN
  -- For UPDATE operations, track what changed
  IF TG_OP = 'UPDATE' THEN
    -- Check each field for changes
    IF OLD.status IS DISTINCT FROM NEW.status THEN
      changed_fields := changed_fields || jsonb_build_object('status', true);
      old_values := old_values || jsonb_build_object('status', OLD.status);
      new_values := new_values || jsonb_build_object('status', NEW.status);
    END IF;

    IF OLD.trusted_user_id IS DISTINCT FROM NEW.trusted_user_id THEN
      changed_fields := changed_fields || jsonb_build_object('trusted_user_id', true);
      old_values := old_values || jsonb_build_object('trusted_user_id', OLD.trusted_user_id);
      new_values := new_values || jsonb_build_object('trusted_user_id', NEW.trusted_user_id);
    END IF;

    IF OLD.requested_at IS DISTINCT FROM NEW.requested_at THEN
      changed_fields := changed_fields || jsonb_build_object('requested_at', true);
      old_values := old_values || jsonb_build_object('requested_at', OLD.requested_at);
      new_values := new_values || jsonb_build_object('requested_at', NEW.requested_at);
    END IF;

    IF OLD.granted_at IS DISTINCT FROM NEW.granted_at THEN
      changed_fields := changed_fields || jsonb_build_object('granted_at', true);
      old_values := old_values || jsonb_build_object('granted_at', OLD.granted_at);
      new_values := new_values || jsonb_build_object('granted_at', NEW.granted_at);
    END IF;

    IF OLD.expires_at IS DISTINCT FROM NEW.expires_at THEN
      changed_fields := changed_fields || jsonb_build_object('expires_at', true);
      old_values := old_values || jsonb_build_object('expires_at', OLD.expires_at);
      new_values := new_values || jsonb_build_object('expires_at', NEW.expires_at);
    END IF;

    IF OLD.permissions IS DISTINCT FROM NEW.permissions THEN
      changed_fields := changed_fields || jsonb_build_object('permissions', true);
      old_values := old_values || jsonb_build_object('permissions', OLD.permissions);
      new_values := new_values || jsonb_build_object('permissions', NEW.permissions);
    END IF;
  END IF;

  -- Log the action
  INSERT INTO emergency_access_audit (
    action,
    emergency_access_id,
    user_id,
    changed_fields,
    old_values,
    new_values,
    ip_address,
    user_agent
  ) VALUES (
    TG_OP,
    COALESCE(NEW.id, OLD.id),
    auth.uid(),
    changed_fields,
    old_values,
    new_values,
    current_setting('request.headers', true)::json->>'cf-connecting-ip',
    current_setting('request.headers', true)::json->>'user-agent'
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger for audit logging
DROP TRIGGER IF EXISTS audit_emergency_access_trigger ON emergency_access;
CREATE TRIGGER audit_emergency_access_trigger
AFTER INSERT OR UPDATE OR DELETE ON emergency_access
FOR EACH ROW
EXECUTE FUNCTION audit_emergency_access_changes();

-- ============================================================================
-- Test to verify the fix works correctly
-- ============================================================================
-- This can be run manually to verify the policy:
--
-- 1. Try to accept an invite (should work):
-- UPDATE emergency_access
-- SET trusted_user_id = auth.uid()
-- WHERE trusted_email = 'user@example.com' AND trusted_user_id IS NULL;
--
-- 2. Try to manipulate status (should fail):
-- UPDATE emergency_access
-- SET trusted_user_id = auth.uid(), status = 'granted'
-- WHERE trusted_email = 'user@example.com' AND trusted_user_id IS NULL;
--
-- 3. Try to manipulate permissions (should fail):
-- UPDATE emergency_access
-- SET trusted_user_id = auth.uid(), permissions = '{"view": true, "export": true}'
-- WHERE trusted_email = 'user@example.com' AND trusted_user_id IS NULL;