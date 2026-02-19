-- ============================================================================
-- CRITICAL SECURITY FIX: Emergency Access RLS Policy Hardening
-- ============================================================================
-- Problem: The "Trustees can accept invite" policy only restricts trusted_user_id
-- but allows manipulation of other critical fields like status and wait_days
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
  -- Only allow setting trusted_user_id to claim the invite
  trusted_user_id = auth.uid()
  AND status = 'accepted'
);

-- Add explicit comment documenting the security requirements
COMMENT ON POLICY "Trustees can accept invite - hardened" ON emergency_access IS
'SECURITY: This policy allows trustees to claim an invite by setting their user_id and status.
All other field immutability is enforced by validate_emergency_access_transition trigger.';

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

    IF OLD.wait_days IS DISTINCT FROM NEW.wait_days THEN
      changed_fields := changed_fields || jsonb_build_object('wait_days', true);
      old_values := old_values || jsonb_build_object('wait_days', OLD.wait_days);
      new_values := new_values || jsonb_build_object('wait_days', NEW.wait_days);
    END IF;

    IF OLD.trustee_public_key IS DISTINCT FROM NEW.trustee_public_key THEN
      changed_fields := changed_fields || jsonb_build_object('trustee_public_key', true);
      old_values := old_values || jsonb_build_object('trustee_public_key', OLD.trustee_public_key);
      new_values := new_values || jsonb_build_object('trustee_public_key', NEW.trustee_public_key);
    END IF;

    IF OLD.trustee_pq_public_key IS DISTINCT FROM NEW.trustee_pq_public_key THEN
      changed_fields := changed_fields || jsonb_build_object('trustee_pq_public_key', true);
      old_values := old_values || jsonb_build_object('trustee_pq_public_key', OLD.trustee_pq_public_key);
      new_values := new_values || jsonb_build_object('trustee_pq_public_key', NEW.trustee_pq_public_key);
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
-- 3. Try to manipulate wait_days (should fail):
-- UPDATE emergency_access
-- SET trusted_user_id = auth.uid(), wait_days = 1
-- WHERE trusted_email = 'user@example.com' AND trusted_user_id IS NULL;
