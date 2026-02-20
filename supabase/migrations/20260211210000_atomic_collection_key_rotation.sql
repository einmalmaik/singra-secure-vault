-- Atomic key rotation for shared collections.
-- Wraps item re-encryption and key swap in a single transaction
-- so that a failure cannot leave the collection in an inconsistent state.

CREATE OR REPLACE FUNCTION rotate_collection_key_atomic(
    p_collection_id UUID,
    p_items JSONB,       -- array of {id, encrypted_data}
    p_new_keys JSONB     -- array of {collection_id, user_id, wrapped_key}
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
    item_record JSONB;
    key_record JSONB;
    v_owner_id UUID;
BEGIN
    -- Verify caller is the collection owner
    SELECT owner_id INTO v_owner_id
    FROM shared_collections
    WHERE id = p_collection_id;

    IF v_owner_id IS NULL THEN
        RAISE EXCEPTION 'Collection not found';
    END IF;

    IF v_owner_id != auth.uid() THEN
        RAISE EXCEPTION 'Only the collection owner can rotate keys';
    END IF;

    -- 1. Update all items with re-encrypted data
    FOR item_record IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        UPDATE shared_collection_items
        SET encrypted_data = item_record->>'encrypted_data'
        WHERE id = (item_record->>'id')::UUID
          AND collection_id = p_collection_id;
    END LOOP;

    -- 2. Delete old keys for this collection
    DELETE FROM collection_keys
    WHERE collection_id = p_collection_id;

    -- 3. Insert new wrapped keys for all members
    FOR key_record IN SELECT * FROM jsonb_array_elements(p_new_keys)
    LOOP
        INSERT INTO collection_keys (collection_id, user_id, wrapped_key)
        VALUES (
            (key_record->>'collection_id')::UUID,
            (key_record->>'user_id')::UUID,
            key_record->>'wrapped_key'
        );
    END LOOP;

    -- If any statement above fails, the entire transaction rolls back automatically.
END;
$func$;

-- Only authenticated users can call this function
REVOKE ALL ON FUNCTION rotate_collection_key_atomic(UUID, JSONB, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION rotate_collection_key_atomic(UUID, JSONB, JSONB) FROM anon;
GRANT EXECUTE ON FUNCTION rotate_collection_key_atomic(UUID, JSONB, JSONB) TO authenticated;