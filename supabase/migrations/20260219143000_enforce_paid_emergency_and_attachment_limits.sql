-- Enforce subscription entitlements for emergency access and secure
-- attachment limits at database level.

-- ============ Entitlement Helper ============

CREATE OR REPLACE FUNCTION public.user_has_active_paid_subscription(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.subscriptions s
        WHERE s.user_id = p_user_id
          AND s.tier IN ('premium', 'families')
          AND s.status IN ('active', 'trialing')
    );
$$;

COMMENT ON FUNCTION public.user_has_active_paid_subscription(UUID) IS
'Returns true when the user has an active/trialing paid tier (premium or families).';

-- ============ Emergency Access (Insert Entitlement) ============

DROP POLICY IF EXISTS "Grantors can create emergency access" ON public.emergency_access;
DROP POLICY IF EXISTS "Users can insert own emergency access as grantor" ON public.emergency_access;

CREATE POLICY "Grantors with paid tier can create emergency access"
    ON public.emergency_access FOR INSERT
    TO authenticated
    WITH CHECK (
        auth.uid() = grantor_id
        AND public.user_has_active_paid_subscription(auth.uid())
    );

-- ============ File Attachments (Security + Limits) ============

CREATE OR REPLACE FUNCTION public.enforce_file_attachments_security()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_current_usage BIGINT;
BEGIN
    -- Service role bypass (backend maintenance/migrations).
    IF auth.role() = 'service_role' THEN
        RETURN NEW;
    END IF;

    IF NEW.user_id IS NULL THEN
        RAISE EXCEPTION 'user_id is required';
    END IF;

    IF auth.uid() IS DISTINCT FROM NEW.user_id THEN
        RAISE EXCEPTION 'Attachment user_id must match authenticated user';
    END IF;

    IF NEW.file_size IS NULL OR NEW.file_size <= 0 THEN
        RAISE EXCEPTION 'Invalid attachment file_size';
    END IF;

    -- 100 MB per file.
    IF NEW.file_size > 104857600 THEN
        RAISE EXCEPTION 'Attachment exceeds 100 MB per-file limit';
    END IF;

    -- Vault ownership hardening.
    IF NOT EXISTS (
        SELECT 1
        FROM public.vault_items vi
        WHERE vi.id = NEW.vault_item_id
          AND vi.user_id = NEW.user_id
    ) THEN
        RAISE EXCEPTION 'Attachment vault item must belong to authenticated user';
    END IF;

    -- Storage path isolation by user prefix.
    IF NEW.storage_path IS NULL OR position((NEW.user_id::text || '/') in NEW.storage_path) <> 1 THEN
        RAISE EXCEPTION 'Attachment storage_path must be namespaced by user_id';
    END IF;

    IF COALESCE(NEW.encrypted, FALSE) IS DISTINCT FROM TRUE THEN
        RAISE EXCEPTION 'Attachment must be stored as encrypted content';
    END IF;

    -- Premium/Families only (insert path).
    IF TG_OP = 'INSERT' AND NOT public.user_has_active_paid_subscription(NEW.user_id) THEN
        RAISE EXCEPTION 'File attachments require an active Premium or Families subscription';
    END IF;

    -- 1 GB total per user (atomic per-user transaction lock).
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id::text, 0));

    SELECT COALESCE(SUM(fa.file_size), 0)
      INTO v_current_usage
      FROM public.file_attachments fa
     WHERE fa.user_id = NEW.user_id
       AND (TG_OP <> 'UPDATE' OR fa.id <> NEW.id);

    IF v_current_usage + NEW.file_size > 1073741824 THEN
        RAISE EXCEPTION 'Attachment storage limit exceeded (1 GB)';
    END IF;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_file_attachments_security() IS
'Enforces owner binding, encryption flags, 100MB per-file and 1GB per-user limits for file attachments.';

DROP TRIGGER IF EXISTS enforce_file_attachments_security_trigger ON public.file_attachments;

CREATE TRIGGER enforce_file_attachments_security_trigger
BEFORE INSERT OR UPDATE ON public.file_attachments
FOR EACH ROW
EXECUTE FUNCTION public.enforce_file_attachments_security();
