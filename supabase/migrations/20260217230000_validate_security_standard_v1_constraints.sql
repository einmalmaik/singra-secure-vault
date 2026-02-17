-- Validate Security Standard v1 constraints and enforce wrapped_key mirror semantics

-- Keep compatibility column deterministic:
-- `wrapped_key` mirrors `pq_wrapped_key` for legacy NOT NULL schema compatibility.
UPDATE public.collection_keys
SET wrapped_key = pq_wrapped_key
WHERE pq_wrapped_key IS NOT NULL
  AND wrapped_key IS DISTINCT FROM pq_wrapped_key;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'collection_keys_wrapped_key_mirrors_pq_check'
          AND conrelid = 'public.collection_keys'::regclass
    ) THEN
        ALTER TABLE public.collection_keys
        ADD CONSTRAINT collection_keys_wrapped_key_mirrors_pq_check
        CHECK (wrapped_key = pq_wrapped_key)
        NOT VALID;
    END IF;
END;
$$;

ALTER TABLE public.collection_keys
VALIDATE CONSTRAINT collection_keys_require_pq_wrapped_key_check;

ALTER TABLE public.collection_keys
VALIDATE CONSTRAINT collection_keys_wrapped_key_mirrors_pq_check;

ALTER TABLE public.emergency_access
VALIDATE CONSTRAINT emergency_access_requires_trustee_pq_key_check;

ALTER TABLE public.emergency_access
VALIDATE CONSTRAINT emergency_access_requires_pq_master_key_check;
