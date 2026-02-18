-- Migration: Harden emergency_access policies and status transitions
-- 20260218223000_harden_emergency_access_policies.sql

-- 1. Function to validate status transitions and prevent unauthorized changes
CREATE OR REPLACE FUNCTION public.validate_emergency_access_transition()
RETURNS TRIGGER AS $$
DECLARE
    is_grantor BOOLEAN;
    is_trustee BOOLEAN;
BEGIN
    is_grantor := (auth.uid() = NEW.grantor_id);
    -- Either already linked, or matches email and is about to be linked
    is_trustee := (auth.uid() = NEW.trusted_user_id) 
                  OR (OLD.trusted_user_id IS NULL AND OLD.trusted_email = current_setting('request.jwt.claim.email', true));

    -- If neither, it's unauthorized (should be caught by RLS, but double check)
    IF NOT is_grantor AND NOT is_trustee THEN
        RAISE EXCEPTION 'Unauthorized access';
    END IF;

    -- Grantor can do most things, but cannot change trusted_email or wait_days after request is pending
    IF is_grantor THEN
        IF OLD.status IN ('pending', 'granted') THEN
            IF (NEW.wait_days IS DISTINCT FROM OLD.wait_days) THEN
                RAISE EXCEPTION 'Cannot change wait_days while access is pending or granted';
            END IF;
        END IF;
        RETURN NEW;
    END IF;

    -- Trustee specific validations
    IF is_trustee THEN
        -- Prevent modification of core fields
        IF (NEW.grantor_id IS DISTINCT FROM OLD.grantor_id) THEN
            RAISE EXCEPTION 'Cannot change grantor_id';
        END IF;
        IF (NEW.wait_days IS DISTINCT FROM OLD.wait_days) THEN
            RAISE EXCEPTION 'Trustees cannot change wait_days';
        END IF;
        IF (NEW.trusted_email IS DISTINCT FROM OLD.trusted_email) THEN
            RAISE EXCEPTION 'Trustees cannot change trusted_email';
        END IF;

        -- Status transition logic for Trustee
        IF (NEW.status IS DISTINCT FROM OLD.status) THEN
            -- Transition: invited -> accepted
            IF (OLD.status = 'invited' AND NEW.status = 'accepted') THEN
                IF NEW.trusted_user_id IS NULL THEN
                    RAISE EXCEPTION 'Trustee must link their user account when accepting';
                END IF;
                RETURN NEW;
            
            -- Transition: accepted -> pending (Request access)
            ELSIF (OLD.status = 'accepted' AND NEW.status = 'pending') THEN
                NEW.requested_at = NOW();
                RETURN NEW;
            
            -- Transition: pending -> granted (Claiming access after cooldown)
            ELSIF (OLD.status = 'pending' AND NEW.status = 'granted') THEN
                IF (OLD.requested_at IS NULL) THEN
                    RAISE EXCEPTION 'Requested at timestamp is missing';
                END IF;
                
                -- Verify cooldown period has passed
                IF (OLD.requested_at + (OLD.wait_days || ' days')::interval > NOW()) THEN
                    RAISE EXCEPTION 'Access cooldown period has not expired yet';
                END IF;
                
                NEW.granted_at = NOW();
                RETURN NEW;

            -- Transition: any -> rejected (Trustee can refuse to be a contact)
            ELSIF (NEW.status = 'rejected') THEN
                RETURN NEW;
            
            ELSE
                RAISE EXCEPTION 'Trustee not allowed to transition status from % to %', OLD.status, NEW.status;
            END IF;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Attach trigger
DROP TRIGGER IF EXISTS validate_emergency_access_transition_trigger ON public.emergency_access;
CREATE TRIGGER validate_emergency_access_transition_trigger
BEFORE UPDATE ON public.emergency_access
FOR EACH ROW EXECUTE FUNCTION public.validate_emergency_access_transition();

-- 3. Update RLS Policies to be more specific
-- "Trustees can accept invite"
DROP POLICY IF EXISTS "Trustees can accept invite" ON emergency_access;
CREATE POLICY "Trustees can accept invite"
ON emergency_access FOR UPDATE
USING (
  trusted_user_id IS NULL AND trusted_email = current_setting('request.jwt.claim.email', true)
)
WITH CHECK (
  trusted_user_id = auth.uid() AND status = 'accepted'
);

-- "Trustees can update linked emergency access"
DROP POLICY IF EXISTS "Trustees can update linked emergency access" ON emergency_access;
CREATE POLICY "Trustees can update linked emergency access"
ON emergency_access FOR UPDATE
USING (auth.uid() = trusted_user_id)
WITH CHECK (
  auth.uid() = trusted_user_id 
  AND status IN ('pending', 'granted', 'rejected', 'accepted')
);
