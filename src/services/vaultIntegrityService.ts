/**
 * @fileoverview Vault Integrity Service — Tamper Detection via HMAC Merkle Tree
 *
 * Protects against a compromised server (or Supabase admin) that could:
 *   - Delete vault items without the user's knowledge
 *   - Replace encrypted ciphertext with garbage
 *   - Replay old versions of items
 *
 * Architecture:
 *   1. Each vault item gets an HMAC: HMAC-SHA-256(integrityKey, itemId || encrypted_data)
 *   2. All HMACs are organized in a Merkle tree
 *   3. The root hash is stored client-side (localStorage)
 *   4. On each vault load: recalculate tree, compare with stored root
 *   5. Mismatch → warning "Vault was modified server-side"
 *
 * The integrityKey is derived from the master password using HKDF with
 * a different context than the encryption key (domain separation).
 *
 * LIMITATIONS:
 *   - Does not prevent a malicious server from serving stale data
 *     (would need server-signed timestamps or blockchain anchoring)
 *   - Root hash in localStorage can be wiped by clearing browser data
 *   - Initial setup has no baseline to compare against
 *
 * @example
 * ```ts
 * // Derive integrity key (once per unlock)
 * const integrityKey = await deriveIntegrityKey(masterPassword, salt);
 *
 * // After loading vault items
 * const result = await verifyVaultIntegrity(items, integrityKey, userId);
 * if (!result.valid) {
 *     showWarning('Vault was tampered with!');
 * }
 *
 * // After saving items, update the root
 * await updateIntegrityRoot(items, integrityKey, userId);
 * ```
 */

import { argon2id } from 'hash-wasm';

// ============ Constants ============

/**
 * HKDF info string for integrity key derivation.
 * Different from encryption key to ensure domain separation.
 */
const INTEGRITY_KEY_INFO = 'SingraPW-IntegrityKey-v1';

/**
 * Argon2id parameters for integrity key (lighter than encryption key
 * since this is a secondary operation and runs after unlock).
 */
const INTEGRITY_KDF_MEMORY = 32768; // 32 MiB
const INTEGRITY_KDF_ITERATIONS = 2;
const INTEGRITY_KDF_PARALLELISM = 2;

/**
 * LocalStorage key prefix for integrity root hashes
 */
const INTEGRITY_ROOT_PREFIX = 'singra_integrity_root_';

// ============ Key Derivation ============

/**
 * Derives an HMAC key for vault integrity verification.
 * Uses Argon2id with different parameters than the main encryption key
 * to ensure domain separation.
 *
 * @param masterPassword - User's master password
 * @param saltBase64 - Base64-encoded salt (same as encryption salt)
 * @returns CryptoKey for HMAC-SHA-256 operations
 */
export async function deriveIntegrityKey(
    masterPassword: string,
    saltBase64: string,
): Promise<CryptoKey> {
    // Derive raw bytes using Argon2id with integrity-specific salt modification
    const integritySalt = saltBase64 + ':integrity';
    const saltBytes = new TextEncoder().encode(integritySalt);

    const hashHex = await argon2id({
        password: masterPassword,
        salt: saltBytes,
        parallelism: INTEGRITY_KDF_PARALLELISM,
        iterations: INTEGRITY_KDF_ITERATIONS,
        memorySize: INTEGRITY_KDF_MEMORY,
        hashLength: 32,
        outputType: 'hex',
    });

    // Convert hex to bytes
    const keyBytes = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
        keyBytes[i] = parseInt(hashHex.substr(i * 2, 2), 16);
    }

    // Import as HMAC key
    const key = await crypto.subtle.importKey(
        'raw',
        keyBytes,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign', 'verify'],
    );

    // Zero the temporary bytes
    keyBytes.fill(0);

    return key;
}

// ============ HMAC Computation ============

/**
 * Computes an HMAC for a single vault item.
 *
 * @param itemId - UUID of the item
 * @param encryptedData - Base64-encoded encrypted item data
 * @param integrityKey - HMAC key
 * @returns Base64-encoded HMAC
 */
async function computeItemHmac(
    itemId: string,
    encryptedData: string,
    integrityKey: CryptoKey,
): Promise<string> {
    // Concatenate itemId and encrypted data
    const message = new TextEncoder().encode(itemId + '|' + encryptedData);

    const signature = await crypto.subtle.sign('HMAC', integrityKey, message);

    return uint8ArrayToBase64(new Uint8Array(signature));
}

// ============ Merkle Tree ============

/**
 * Builds a Merkle tree from an array of item HMACs.
 *
 * @param hmacs - Array of base64-encoded HMACs (sorted by item ID)
 * @returns Root hash as base64 string
 */
async function buildMerkleRoot(hmacs: string[]): Promise<string> {
    if (hmacs.length === 0) {
        // Empty vault has a deterministic empty root
        return 'EMPTY_VAULT_ROOT';
    }

    if (hmacs.length === 1) {
        return hmacs[0];
    }

    // Build tree level by level
    let currentLevel = hmacs;

    while (currentLevel.length > 1) {
        const nextLevel: string[] = [];

        for (let i = 0; i < currentLevel.length; i += 2) {
            if (i + 1 < currentLevel.length) {
                // Hash pair
                const combined = currentLevel[i] + currentLevel[i + 1];
                const hash = await sha256(combined);
                nextLevel.push(hash);
            } else {
                // Odd node, carry up
                nextLevel.push(currentLevel[i]);
            }
        }

        currentLevel = nextLevel;
    }

    return currentLevel[0];
}

/**
 * Computes SHA-256 hash of a string.
 */
async function sha256(data: string): Promise<string> {
    const bytes = new TextEncoder().encode(data);
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    return uint8ArrayToBase64(new Uint8Array(hash));
}

// ============ Verification ============

/**
 * Verifies the integrity of all vault items against the stored root hash.
 *
 * @param items - Array of vault items with id and encrypted_data
 * @param integrityKey - HMAC key
 * @param userId - User ID (for localStorage key)
 * @returns Verification result
 */
export async function verifyVaultIntegrity(
    items: VaultItemForIntegrity[],
    integrityKey: CryptoKey,
    userId: string,
): Promise<IntegrityVerificationResult> {
    // Sort items by ID for deterministic ordering
    const sortedItems = [...items].sort((a, b) => a.id.localeCompare(b.id));

    // Compute HMAC for each item
    const hmacs: string[] = [];
    for (const item of sortedItems) {
        const hmac = await computeItemHmac(item.id, item.encrypted_data, integrityKey);
        hmacs.push(hmac);
    }

    // Build Merkle root
    const computedRoot = await buildMerkleRoot(hmacs);

    // Get stored root
    const storedRoot = localStorage.getItem(INTEGRITY_ROOT_PREFIX + userId);

    // First-time setup: no stored root yet
    if (!storedRoot) {
        return {
            valid: true,
            isFirstCheck: true,
            computedRoot,
            itemCount: items.length,
        };
    }

    // Compare roots
    const valid = computedRoot === storedRoot;

    return {
        valid,
        isFirstCheck: false,
        computedRoot,
        storedRoot,
        itemCount: items.length,
    };
}

/**
 * Updates the stored integrity root hash after vault modifications.
 * Should be called after successful item create/update/delete.
 *
 * @param items - Current array of all vault items
 * @param integrityKey - HMAC key
 * @param userId - User ID
 * @returns The new root hash
 */
export async function updateIntegrityRoot(
    items: VaultItemForIntegrity[],
    integrityKey: CryptoKey,
    userId: string,
): Promise<string> {
    // Sort items by ID
    const sortedItems = [...items].sort((a, b) => a.id.localeCompare(b.id));

    // Compute HMACs
    const hmacs: string[] = [];
    for (const item of sortedItems) {
        const hmac = await computeItemHmac(item.id, item.encrypted_data, integrityKey);
        hmacs.push(hmac);
    }

    // Build Merkle root
    const root = await buildMerkleRoot(hmacs);

    // Store in localStorage
    localStorage.setItem(INTEGRITY_ROOT_PREFIX + userId, root);

    return root;
}

/**
 * Clears the stored integrity root for a user.
 * Should be called on logout or account deletion.
 *
 * @param userId - User ID
 */
export function clearIntegrityRoot(userId: string): void {
    localStorage.removeItem(INTEGRITY_ROOT_PREFIX + userId);
}

/**
 * Checks if an integrity root exists for a user.
 *
 * @param userId - User ID
 * @returns true if root exists
 */
export function hasIntegrityRoot(userId: string): boolean {
    return localStorage.getItem(INTEGRITY_ROOT_PREFIX + userId) !== null;
}

// ============ Utility Functions ============

/**
 * Converts Uint8Array to Base64 string
 */
function uint8ArrayToBase64(bytes: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

// ============ Type Definitions ============

/**
 * Minimal vault item structure needed for integrity checks
 */
export interface VaultItemForIntegrity {
    id: string;
    encrypted_data: string;
}

/**
 * Result of integrity verification
 */
export interface IntegrityVerificationResult {
    /** Whether the vault integrity is valid */
    valid: boolean;
    /** True if this is the first check (no stored root to compare) */
    isFirstCheck: boolean;
    /** The computed Merkle root */
    computedRoot: string;
    /** The previously stored root (if exists) */
    storedRoot?: string;
    /** Number of items in the vault */
    itemCount: number;
}
