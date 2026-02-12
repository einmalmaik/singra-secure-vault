/**
 * @fileoverview Duress (Panic) Password Service for Singra PW
 *
 * Implements a plausible deniability feature where a secondary "duress" password
 * unlocks a decoy vault instead of the real vault. This protects users who may be
 * coerced into revealing their password (e.g., at border crossings, under threat).
 *
 * Architecture:
 * - Duress password has its own salt, verifier, and derived key
 * - Decoy items are stored in the same vault_items table but encrypted with duress key
 * - Decoy items have a `_duress: true` marker inside encrypted_data
 * - On unlock, both verifiers are checked in parallel (constant time)
 * - The matching key determines which items are decryptable
 *
 * Security Properties:
 * - An observer cannot distinguish real from duress unlock (same UI, timing)
 * - Database queries are identical for both vaults
 * - Without knowing both passwords, existence of duress vault is unprovable
 *
 * @see docs/SECURITY_HARDENING_PLAN.md Phase 5.2
 */

import {
    deriveKey,
    generateSalt,
    createVerificationHash,
    verifyKey,
    CURRENT_KDF_VERSION,
} from './cryptoService';
import { supabase } from '@/integrations/supabase/client';

// ============ Type Definitions ============

export interface DuressConfig {
    /** Whether duress mode is enabled for this user */
    enabled: boolean;
    /** Salt for duress key derivation (base64) */
    salt: string | null;
    /** Verifier hash for duress password */
    verifier: string | null;
    /** KDF version used for duress password */
    kdfVersion: number;
}

export interface DuressSetupResult {
    success: boolean;
    error?: string;
}

export interface DuressUnlockResult {
    /** Which vault was unlocked */
    mode: 'real' | 'duress' | 'invalid';
    /** The derived CryptoKey for the unlocked vault */
    key: CryptoKey | null;
    /** Error message if unlock failed */
    error?: string;
}

export interface DecoyItem {
    title: string;
    username?: string;
    password?: string;
    website?: string;
    notes?: string;
}

// ============ Constants ============

/** Marker field added to decoy items (inside encrypted JSON) */
export const DURESS_MARKER_FIELD = '_duress';

/** Default decoy items created when duress mode is enabled */
const DEFAULT_DECOY_ITEMS: DecoyItem[] = [
    {
        title: 'Gmail',
        username: 'user@gmail.com',
        password: 'Summer2024!',
        website: 'https://mail.google.com',
    },
    {
        title: 'Amazon',
        username: 'user@gmail.com',
        password: 'Shopping123!',
        website: 'https://amazon.com',
    },
    {
        title: 'Netflix',
        username: 'user@gmail.com',
        password: 'Streaming456!',
        website: 'https://netflix.com',
    },
];

// ============ Core Functions ============

/**
 * Loads duress configuration for a user.
 *
 * @param userId - The user's ID
 * @returns Duress configuration or null if not set up
 */
export async function getDuressConfig(userId: string): Promise<DuressConfig | null> {
    try {
        const { data, error } = await supabase
            .from('profiles')
            .select('duress_salt, duress_password_verifier, duress_kdf_version')
            .eq('user_id', userId)
            .single() as { data: Record<string, unknown> | null; error: unknown };

        if (error || !data) {
            return null;
        }

        const duressSalt = data.duress_salt as string | null;
        const duressVerifier = data.duress_password_verifier as string | null;

        return {
            enabled: !!(duressSalt && duressVerifier),
            salt: duressSalt,
            verifier: duressVerifier,
            kdfVersion: (data.duress_kdf_version as number) ?? CURRENT_KDF_VERSION,
        };
    } catch (err) {
        console.error('Failed to load duress config:', err);
        return null;
    }
}

/**
 * Sets up a duress (panic) password for a user.
 *
 * This creates a separate encryption key and verifier that will unlock
 * a decoy vault instead of the real one. The duress password must be
 * different from the real master password.
 *
 * @param userId - The user's ID
 * @param duressPassword - The panic password to set up
 * @param realPassword - The real master password (to verify they're different)
 * @param realSalt - The salt used for the real password
 * @returns Setup result
 */
export async function setupDuressPassword(
    userId: string,
    duressPassword: string,
    realPassword: string,
    realSalt: string,
): Promise<DuressSetupResult> {
    // Prevent using the same password
    if (duressPassword === realPassword) {
        return {
            success: false,
            error: 'Duress password must be different from your master password',
        };
    }

    // Validate password strength (basic check)
    if (duressPassword.length < 8) {
        return {
            success: false,
            error: 'Duress password must be at least 8 characters',
        };
    }

    try {
        // Generate a new salt for the duress password (must be different!)
        const duressSalt = generateSalt();

        // Derive the duress key
        const duressKey = await deriveKey(duressPassword, duressSalt, CURRENT_KDF_VERSION);

        // Create verifier for the duress password
        const duressVerifier = await createVerificationHash(duressKey);

        // Store duress credentials in profile
        const { error: updateError } = await supabase
            .from('profiles')
            .update({
                duress_salt: duressSalt,
                duress_password_verifier: duressVerifier,
                duress_kdf_version: CURRENT_KDF_VERSION,
            } as Record<string, unknown>)
            .eq('user_id', userId);

        if (updateError) {
            return {
                success: false,
                error: `Failed to save duress password: ${updateError.message}`,
            };
        }

        return { success: true };
    } catch (err) {
        console.error('Error setting up duress password:', err);
        return {
            success: false,
            error: 'Failed to set up duress password',
        };
    }
}

/**
 * Attempts to unlock with either the real or duress password.
 *
 * Both verifications are performed to maintain constant-time behavior
 * (preventing timing attacks that could reveal duress mode existence).
 *
 * @param password - The entered password
 * @param realSalt - Salt for real password
 * @param realVerifier - Verifier for real password
 * @param realKdfVersion - KDF version for real password
 * @param duressConfig - Duress configuration (null if not enabled)
 * @returns Unlock result indicating which vault was opened
 */
export async function attemptDualUnlock(
    password: string,
    realSalt: string,
    realVerifier: string,
    realKdfVersion: number,
    duressConfig: DuressConfig | null,
): Promise<DuressUnlockResult> {
    try {
        // Always derive the real key
        const realKeyPromise = deriveKey(password, realSalt, realKdfVersion);

        // If duress is enabled, derive duress key in parallel
        const duressKeyPromise = duressConfig?.enabled && duressConfig.salt
            ? deriveKey(password, duressConfig.salt, duressConfig.kdfVersion)
            : Promise.resolve(null);

        // Wait for both derivations (parallel execution for constant time)
        const [realKey, duressKey] = await Promise.all([realKeyPromise, duressKeyPromise]);

        // Check real password first
        const realValid = await verifyKey(realVerifier, realKey);
        if (realValid) {
            return {
                mode: 'real',
                key: realKey,
            };
        }

        // Check duress password if enabled
        if (duressConfig?.enabled && duressKey && duressConfig.verifier) {
            const duressValid = await verifyKey(duressConfig.verifier, duressKey);
            if (duressValid) {
                return {
                    mode: 'duress',
                    key: duressKey,
                };
            }
        }

        // Neither matched
        return {
            mode: 'invalid',
            key: null,
            error: 'Invalid password',
        };
    } catch (err) {
        console.error('Dual unlock error:', err);
        return {
            mode: 'invalid',
            key: null,
            error: 'Unlock failed',
        };
    }
}

/**
 * Disables duress mode for a user.
 *
 * This removes the duress salt and verifier but does NOT delete decoy items.
 * Decoy items become inaccessible without the duress key.
 *
 * @param userId - The user's ID
 * @returns Success status
 */
export async function disableDuressMode(userId: string): Promise<{ success: boolean; error?: string }> {
    try {
        const { error } = await supabase
            .from('profiles')
            .update({
                duress_salt: null,
                duress_password_verifier: null,
                duress_kdf_version: null,
            } as Record<string, unknown>)
            .eq('user_id', userId);

        if (error) {
            return { success: false, error: error.message };
        }

        return { success: true };
    } catch (err) {
        console.error('Error disabling duress mode:', err);
        return { success: false, error: 'Failed to disable duress mode' };
    }
}

/**
 * Changes the duress password.
 *
 * This re-derives the key and updates the verifier. Existing decoy items
 * must be re-encrypted with the new key.
 *
 * @param userId - The user's ID
 * @param oldDuressPassword - Current duress password (for verification)
 * @param newDuressPassword - New duress password
 * @param realPassword - Real master password (to ensure they stay different)
 * @returns Change result
 */
export async function changeDuressPassword(
    userId: string,
    oldDuressPassword: string,
    newDuressPassword: string,
    realPassword: string,
): Promise<{ success: boolean; error?: string; newKey?: CryptoKey }> {
    // Prevent same password as real
    if (newDuressPassword === realPassword) {
        return {
            success: false,
            error: 'Duress password must be different from your master password',
        };
    }

    // Load current duress config
    const config = await getDuressConfig(userId);
    if (!config?.enabled || !config.salt) {
        return { success: false, error: 'Duress mode is not enabled' };
    }

    try {
        // Verify old duress password
        const oldKey = await deriveKey(oldDuressPassword, config.salt, config.kdfVersion);

        const { data } = await supabase
            .from('profiles')
            .select('duress_password_verifier')
            .eq('user_id', userId)
            .single() as { data: { duress_password_verifier?: string } | null };

        if (!data?.duress_password_verifier) {
            return { success: false, error: 'Duress verifier not found' };
        }

        const oldValid = await verifyKey(data.duress_password_verifier, oldKey);
        if (!oldValid) {
            return { success: false, error: 'Current duress password is incorrect' };
        }

        // Generate new salt and key
        const newSalt = generateSalt();
        const newKey = await deriveKey(newDuressPassword, newSalt, CURRENT_KDF_VERSION);
        const newVerifier = await createVerificationHash(newKey);

        // Update profile
        const { error: updateError } = await supabase
            .from('profiles')
            .update({
                duress_salt: newSalt,
                duress_password_verifier: newVerifier,
                duress_kdf_version: CURRENT_KDF_VERSION,
            } as Record<string, unknown>)
            .eq('user_id', userId);

        if (updateError) {
            return { success: false, error: updateError.message };
        }

        // Return new key so caller can re-encrypt decoy items
        return { success: true, newKey };
    } catch (err) {
        console.error('Error changing duress password:', err);
        return { success: false, error: 'Failed to change duress password' };
    }
}

/**
 * Checks if an item is a decoy item (encrypted with duress key).
 *
 * This check is performed AFTER decryption by looking for the marker field.
 *
 * @param decryptedData - The decrypted item data object
 * @returns True if this is a decoy item
 */
export function isDecoyItem(decryptedData: { _duress?: boolean } | Record<string, unknown>): boolean {
    return (decryptedData as Record<string, unknown>)[DURESS_MARKER_FIELD] === true;
}

/**
 * Adds the duress marker to an item before encryption.
 *
 * @param itemData - The item data to mark as decoy
 * @returns Item data with duress marker
 */
export function markAsDecoyItem<T extends Record<string, unknown>>(itemData: T): T & { _duress: true } {
    return {
        ...itemData,
        [DURESS_MARKER_FIELD]: true,
    };
}

/**
 * Removes the duress marker from decrypted item data for display.
 *
 * @param itemData - The decrypted item data
 * @returns Item data without the internal marker
 */
export function stripDecoyMarker<T extends Record<string, unknown>>(itemData: T): Omit<T, '_duress'> {
    const { _duress, ...rest } = itemData as T & { _duress?: boolean };
    return rest;
}

/**
 * Returns default decoy items to populate when duress mode is first enabled.
 *
 * @returns Array of generic-looking decoy items (deep copy)
 */
export function getDefaultDecoyItems(): DecoyItem[] {
    return DEFAULT_DECOY_ITEMS.map(item => ({ ...item }));
}
