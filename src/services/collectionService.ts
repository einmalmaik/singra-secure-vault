/**
 * @fileoverview Collection Service for Shared Collections
 * 
 * Implements secure sharing of vault items using hybrid encryption:
 * - RSA-4096 for key wrapping
 * - AES-256-GCM for item encryption
 */

import { supabase } from '@/integrations/supabase/client';
import { 
    generateSharedKey, 
    wrapKey, 
    unwrapKey,
    encryptWithSharedKey,
    decryptWithSharedKey,
    VaultItemData
} from './cryptoService';

// ============ Type Definitions ============

export interface CollectionMember {
    id: string;
    user_id: string;
    email: string;
    permission: 'view' | 'edit';
    created_at: string;
}

export interface CollectionItem {
    id: string;
    vault_item_id: string;
    added_by: string;
    created_at: string;
    encrypted_data: string;
    decrypted_data?: VaultItemData;
}

export interface SharedCollection {
    id: string;
    owner_id: string;
    name: string;
    description: string | null;
    member_count: number;
    item_count: number;
    created_at: string;
    updated_at: string;
    is_owner?: boolean;
    user_permission?: 'view' | 'edit';
}

export interface AuditLogEntry {
    id: string;
    collection_id: string;
    user_id: string | null;
    action: string;
    details: any;
    created_at: string;
}

// ============ Collection Management ============

/**
 * Creates a new collection with a shared encryption key
 * 
 * @param name - Collection name
 * @param description - Optional description
 * @param publicKey - Owner's public key (JWK string)
 * @returns Collection ID
 */
export async function createCollectionWithKey(
    name: string,
    description: string | null,
    publicKey: string
): Promise<string> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');
    
    // 1. Create Collection
    const { data: collection, error: collectionError } = await supabase
        .from('shared_collections')
        .insert({ name, description, owner_id: user.id })
        .select()
        .single();
    
    if (collectionError) throw collectionError;
    
    try {
        // 2. Generate Shared Key
        const sharedKey = await generateSharedKey();
        
        // 3. Wrap Shared Key with Owner's Public Key
        const wrappedKey = await wrapKey(sharedKey, publicKey);
        
        // 4. Store wrapped Key
        const { error: keyError } = await supabase
            .from('collection_keys')
            .insert({
                collection_id: collection.id,
                user_id: user.id,
                wrapped_key: wrappedKey,
            });
        
        if (keyError) throw keyError;
        
        return collection.id;
    } catch (error) {
        // Rollback: Delete collection if key creation failed
        await supabase
            .from('shared_collections')
            .delete()
            .eq('id', collection.id);
        throw error;
    }
}

/**
 * Gets all collections (owned + member)
 * 
 * @returns Array of collections with role/permission info
 */
export async function getAllCollections(): Promise<SharedCollection[]> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return [];
    
    // Get owned collections
    const { data: ownedCollections, error: ownedError } = await supabase
        .from('shared_collections')
        .select('*')
        .eq('owner_id', user.id)
        .order('created_at', { ascending: false });
    
    if (ownedError) throw ownedError;
    
    // Get collections where user is a member
    const { data: memberCollections, error: memberError } = await supabase
        .from('shared_collection_members')
        .select(`
            permission,
            shared_collections (*)
        `)
        .eq('user_id', user.id);
    
    if (memberError) throw memberError;
    
    // Combine and mark ownership
    const owned = (ownedCollections || []).map(c => ({
        ...c,
        is_owner: true,
        user_permission: undefined,
    }));
    
    const member = (memberCollections || []).map(m => ({
        ...(m.shared_collections as any),
        is_owner: false,
        user_permission: m.permission,
    }));
    
    return [...owned, ...member];
}

/**
 * Deletes a collection (owner only)
 * 
 * @param collectionId - Collection ID
 */
export async function deleteCollection(collectionId: string): Promise<void> {
    const { error } = await supabase
        .from('shared_collections')
        .delete()
        .eq('id', collectionId);
    
    if (error) throw error;
}

// ============ Member Management ============

/**
 * Adds a member to a collection
 * 
 * @param collectionId - Collection ID
 * @param userId - User ID to add
 * @param permission - 'view' or 'edit'
 * @param ownerPrivateKey - Owner's encrypted private key
 * @param memberPublicKey - Member's public key
 * @param masterPassword - Owner's master password
 */
export async function addMemberToCollection(
    collectionId: string,
    userId: string,
    permission: 'view' | 'edit',
    ownerPrivateKey: string,
    memberPublicKey: string,
    masterPassword: string
): Promise<void> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');
    
    // 1. Load wrapped Shared Key for Owner
    const { data: ownerKey, error: keyError } = await supabase
        .from('collection_keys')
        .select('wrapped_key')
        .eq('collection_id', collectionId)
        .eq('user_id', user.id)
        .single();
    
    if (keyError || !ownerKey) throw new Error('Collection key not found');
    
    // 2. Unwrap Shared Key
    const sharedKey = await unwrapKey(ownerKey.wrapped_key, ownerPrivateKey, masterPassword);
    
    // 3. Wrap Shared Key with Member's Public Key
    const wrappedKey = await wrapKey(sharedKey, memberPublicKey);
    
    // 4. Add Member
    const { error: memberError } = await supabase
        .from('shared_collection_members')
        .insert({
            collection_id: collectionId,
            user_id: userId,
            permission,
        });
    
    if (memberError) throw memberError;
    
    // 5. Store wrapped Key for Member
    const { error: memberKeyError } = await supabase
        .from('collection_keys')
        .insert({
            collection_id: collectionId,
            user_id: userId,
            wrapped_key: wrappedKey,
        });
    
    if (memberKeyError) {
        // Rollback: Remove member if key creation failed
        await supabase
            .from('shared_collection_members')
            .delete()
            .eq('collection_id', collectionId)
            .eq('user_id', userId);
        throw memberKeyError;
    }
}

/**
 * Removes a member from a collection
 * 
 * @param collectionId - Collection ID
 * @param userId - User ID to remove
 */
export async function removeMemberFromCollection(
    collectionId: string,
    userId: string
): Promise<void> {
    // 1. Remove Member
    const { error: memberError } = await supabase
        .from('shared_collection_members')
        .delete()
        .eq('collection_id', collectionId)
        .eq('user_id', userId);
    
    if (memberError) throw memberError;
    
    // 2. Delete wrapped Key
    const { error: keyError } = await supabase
        .from('collection_keys')
        .delete()
        .eq('collection_id', collectionId)
        .eq('user_id', userId);
    
    if (keyError) throw keyError;
}

/**
 * Gets all members of a collection
 * 
 * @param collectionId - Collection ID
 * @returns Array of collection members
 */
export async function getCollectionMembers(collectionId: string): Promise<CollectionMember[]> {
    const { data, error } = await supabase
        .from('shared_collection_members')
        .select(`
            id,
            user_id,
            permission,
            created_at,
            profiles!inner(email)
        `)
        .eq('collection_id', collectionId);
    
    if (error) throw error;
    
    return (data || []).map(m => ({
        id: m.id,
        user_id: m.user_id,
        email: (m.profiles as any).email,
        permission: m.permission as 'view' | 'edit',
        created_at: m.created_at,
    }));
}

/**
 * Updates a member's permission
 * 
 * @param collectionId - Collection ID
 * @param userId - User ID
 * @param permission - New permission ('view' or 'edit')
 */
export async function updateMemberPermission(
    collectionId: string,
    userId: string,
    permission: 'view' | 'edit'
): Promise<void> {
    const { error } = await supabase
        .from('shared_collection_members')
        .update({ permission })
        .eq('collection_id', collectionId)
        .eq('user_id', userId);
    
    if (error) throw error;
}

// ============ Item Management ============

/**
 * Adds an item to a collection
 * 
 * @param collectionId - Collection ID
 * @param vaultItemId - Vault item ID
 * @param itemData - Decrypted item data
 * @param privateKey - User's encrypted private key
 * @param masterPassword - User's master password
 */
export async function addItemToCollection(
    collectionId: string,
    vaultItemId: string,
    itemData: VaultItemData,
    privateKey: string,
    masterPassword: string
): Promise<void> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');
    
    // 1. Load wrapped Shared Key
    const { data: keyData, error: keyError } = await supabase
        .from('collection_keys')
        .select('wrapped_key')
        .eq('collection_id', collectionId)
        .eq('user_id', user.id)
        .single();
    
    if (keyError || !keyData) throw new Error('Collection key not found');
    
    // 2. Unwrap Shared Key
    const sharedKey = await unwrapKey(keyData.wrapped_key, privateKey, masterPassword);
    
    // 3. Encrypt Item with Shared Key
    const encryptedData = await encryptWithSharedKey(itemData, sharedKey);
    
    // 4. Add Item
    const { error } = await supabase
        .from('shared_collection_items')
        .insert({
            collection_id: collectionId,
            vault_item_id: vaultItemId,
            encrypted_data: encryptedData,
            added_by: user.id,
        });
    
    if (error) throw error;
}

/**
 * Removes an item from a collection
 * 
 * @param collectionId - Collection ID
 * @param itemId - Collection item ID (not vault_item_id)
 */
export async function removeItemFromCollection(
    collectionId: string,
    itemId: string
): Promise<void> {
    const { error } = await supabase
        .from('shared_collection_items')
        .delete()
        .eq('id', itemId)
        .eq('collection_id', collectionId);
    
    if (error) throw error;
}

/**
 * Gets all items in a collection (decrypted)
 * 
 * @param collectionId - Collection ID
 * @param privateKey - User's encrypted private key
 * @param masterPassword - User's master password
 * @returns Array of collection items with decrypted data
 */
export async function getCollectionItems(
    collectionId: string,
    privateKey: string,
    masterPassword: string
): Promise<CollectionItem[]> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');
    
    // 1. Load wrapped Shared Key
    const { data: keyData, error: keyError } = await supabase
        .from('collection_keys')
        .select('wrapped_key')
        .eq('collection_id', collectionId)
        .eq('user_id', user.id)
        .single();
    
    if (keyError || !keyData) throw new Error('Collection key not found');
    
    // 2. Unwrap Shared Key
    const sharedKey = await unwrapKey(keyData.wrapped_key, privateKey, masterPassword);
    
    // 3. Load Items
    const { data: items, error } = await supabase
        .from('shared_collection_items')
        .select('*')
        .eq('collection_id', collectionId);
    
    if (error) throw error;
    
    // 4. Decrypt Items
    const decryptedItems = await Promise.all(
        (items || []).map(async (item) => {
            try {
                const decrypted_data = await decryptWithSharedKey(item.encrypted_data, sharedKey);
                return {
                    ...item,
                    decrypted_data,
                };
            } catch (error) {
                console.error('Failed to decrypt item:', item.id, error);
                return {
                    ...item,
                    decrypted_data: undefined,
                };
            }
        })
    );
    
    return decryptedItems;
}

// ============ Audit Log ============

/**
 * Gets audit log for a collection
 * 
 * @param collectionId - Collection ID
 * @returns Array of audit log entries
 */
export async function getCollectionAuditLog(collectionId: string): Promise<AuditLogEntry[]> {
    const { data, error } = await supabase
        .from('collection_audit_log')
        .select('*')
        .eq('collection_id', collectionId)
        .order('created_at', { ascending: false })
        .limit(100);
    
    if (error) throw error;
    
    return data || [];
}

// ============ Key Rotation ============

/**
 * Rotates the shared key for a collection
 * Re-encrypts all items with a new key
 * 
 * @param collectionId - Collection ID
 * @param privateKey - Owner's encrypted private key
 * @param masterPassword - Owner's master password
 */
export async function rotateCollectionKey(
    collectionId: string,
    privateKey: string,
    masterPassword: string
): Promise<void> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');
    
    // 1. Load old wrapped key
    const { data: oldKeyData, error: oldKeyError } = await supabase
        .from('collection_keys')
        .select('wrapped_key')
        .eq('collection_id', collectionId)
        .eq('user_id', user.id)
        .single();
    
    if (oldKeyError || !oldKeyData) throw new Error('Collection key not found');
    
    // 2. Unwrap old key
    const oldSharedKey = await unwrapKey(oldKeyData.wrapped_key, privateKey, masterPassword);
    
    // 3. Load all items
    const { data: items, error: itemsError } = await supabase
        .from('shared_collection_items')
        .select('*')
        .eq('collection_id', collectionId);
    
    if (itemsError) throw itemsError;
    
    // 4. Generate new shared key
    const newSharedKey = await generateSharedKey();
    
    // 5. Re-encrypt all items
    const reencryptedItems = await Promise.all(
        (items || []).map(async (item) => {
            const decrypted = await decryptWithSharedKey(item.encrypted_data, oldSharedKey);
            const encrypted = await encryptWithSharedKey(decrypted, newSharedKey);
            return {
                id: item.id,
                encrypted_data: encrypted,
            };
        })
    );
    
    // 6. Load all members (including owner)
    const { data: members, error: membersError } = await supabase
        .from('collection_keys')
        .select('user_id')
        .eq('collection_id', collectionId);
    
    if (membersError) throw membersError;
    
    // 7. Load public keys for all members
    const { data: publicKeys, error: publicKeysError } = await supabase
        .from('user_keys')
        .select('user_id, public_key')
        .in('user_id', (members || []).map(m => m.user_id));
    
    if (publicKeysError) throw publicKeysError;
    
    // 8. Wrap new key for all members
    const newWrappedKeys = await Promise.all(
        (publicKeys || []).map(async (pk) => {
            const wrapped = await wrapKey(newSharedKey, pk.public_key);
            return {
                collection_id: collectionId,
                user_id: pk.user_id,
                wrapped_key: wrapped,
            };
        })
    );
    
    // 9. Update database (transaction-like)
    try {
        // Update items
        for (const item of reencryptedItems) {
            const { error } = await supabase
                .from('shared_collection_items')
                .update({ encrypted_data: item.encrypted_data })
                .eq('id', item.id);
            
            if (error) throw error;
        }
        
        // Delete old keys
        const { error: deleteError } = await supabase
            .from('collection_keys')
            .delete()
            .eq('collection_id', collectionId);
        
        if (deleteError) throw deleteError;
        
        // Insert new keys
        const { error: insertError } = await supabase
            .from('collection_keys')
            .insert(newWrappedKeys);
        
        if (insertError) throw insertError;
        
    } catch (error) {
        console.error('Key rotation failed:', error);
        throw new Error('Key rotation failed. Collection may be in inconsistent state.');
    }
}
