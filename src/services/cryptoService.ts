/**
 * @fileoverview Cryptographic Service for Singra PW
 * 
 * Implements zero-knowledge client-side encryption using:
 * - Argon2id for key derivation from master password
 * - AES-256-GCM for authenticated encryption of vault data
 * 
 * Supports KDF parameter versioning for transparent auto-migration
 * to stronger parameters after successful unlock.
 * 
 * SECURITY: The master password NEVER leaves the client.
 * Only encrypted data is stored on the server.
 */

import { argon2id } from 'hash-wasm';
import { SecureBuffer } from './secureBuffer';

// ============ KDF Parameter Definitions ============

/**
 * The latest KDF version. Newly set-up accounts use this version.
 * Existing users on older versions are auto-migrated on unlock.
 */
export const CURRENT_KDF_VERSION = 2;

/**
 * KDF parameter sets indexed by version number.
 *
 *   v1: Original (64 MiB) — ~300 ms on modern devices
 *   v2: Enhanced (128 MiB) — ~500-600 ms on modern devices, OWASP 2025 recommended
 *
 * IMPORTANT: Once a version is released, its parameters MUST NEVER be changed.
 * Only add new versions.
 */
export const KDF_PARAMS: Record<number, KdfParams> = {
    1: { memory: 65536,  iterations: 3, parallelism: 4, hashLength: 32 },
    2: { memory: 131072, iterations: 3, parallelism: 4, hashLength: 32 },
};

const SALT_LENGTH = 16; // 128 bits
const IV_LENGTH = 12; // 96 bits (standard for AES-GCM)
const TAG_LENGTH = 128; // 128 bits authentication tag

/**
 * Generates a cryptographically secure random salt
 * @returns Base64-encoded salt string
 */
export function generateSalt(): string {
    const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
    return uint8ArrayToBase64(salt);
}

/**
 * Derives raw AES-256 key bytes from master password using Argon2id.
 * 
 * @param masterPassword - The user's master password
 * @param saltBase64 - Base64-encoded salt from profiles table
 * @param kdfVersion - KDF parameter version (defaults to 1 for backward compat)
 * @returns Raw key bytes (caller is responsible for wiping with .fill(0))
 */
export async function deriveRawKey(
    masterPassword: string,
    saltBase64: string,
    kdfVersion: number = 1
): Promise<Uint8Array> {
    const params = KDF_PARAMS[kdfVersion];
    if (!params) {
        throw new Error(`Unknown KDF version: ${kdfVersion}`);
    }

    const salt = base64ToUint8Array(saltBase64);

    // Derive raw key bytes using Argon2id via hash-wasm
    const hashHex = await argon2id({
        password: masterPassword,
        salt: salt,
        parallelism: params.parallelism,
        iterations: params.iterations,
        memorySize: params.memory,
        hashLength: params.hashLength,
        outputType: 'hex',
    });

    // Convert hex to bytes
    const keyBytes = new Uint8Array(hashHex.length / 2);
    for (let i = 0; i < keyBytes.length; i++) {
        keyBytes[i] = parseInt(hashHex.substr(i * 2, 2), 16);
    }
    return keyBytes;
}

/**
 * Derives raw AES-256 key bytes wrapped in a SecureBuffer for safer handling.
 * The SecureBuffer auto-zeros on destroy and prevents accidental leaks.
 *
 * @param masterPassword - The user's master password
 * @param saltBase64 - Base64-encoded salt from profiles table
 * @param kdfVersion - KDF parameter version (defaults to 1 for backward compat)
 * @returns SecureBuffer containing raw key bytes (caller MUST call .destroy())
 */
export async function deriveRawKeySecure(
    masterPassword: string,
    saltBase64: string,
    kdfVersion: number = 1
): Promise<SecureBuffer> {
    const rawBytes = await deriveRawKey(masterPassword, saltBase64, kdfVersion);
    const secure = SecureBuffer.fromBytes(rawBytes);
    // Zero the temporary copy immediately
    rawBytes.fill(0);
    return secure;
}

/**
 * Derives an AES-256 encryption key from master password using Argon2id
 * 
 * @param masterPassword - The user's master password
 * @param saltBase64 - Base64-encoded salt from profiles table
 * @param kdfVersion - KDF parameter version (defaults to 1 for backward compat)
 * @returns CryptoKey suitable for AES-GCM operations
 */
export async function deriveKey(
    masterPassword: string,
    saltBase64: string,
    kdfVersion: number = 1
): Promise<CryptoKey> {
    const keyBytes = await deriveRawKey(masterPassword, saltBase64, kdfVersion);
    try {
        return await importMasterKey(keyBytes);
    } finally {
        // SECURITY: Wipe raw key bytes from memory as soon as the
        // non-extractable CryptoKey has been created.
        keyBytes.fill(0);
    }
}

/**
 * Imports a raw AES-256 key bytes into a CryptoKey
 * 
 * @param keyBytes - Raw key bytes
 * @returns CryptoKey suitable for AES-GCM operations
 */
export async function importMasterKey(
    keyBytes: Uint8Array | BufferSource
): Promise<CryptoKey> {
    return crypto.subtle.importKey(
        'raw',
        keyBytes as BufferSource, // BufferSource type for importKey
        { name: 'AES-GCM', length: 256 },
        false, // not extractable
        ['encrypt', 'decrypt']
    );
}

/**
 * Encrypts plaintext data using AES-256-GCM
 * 
 * Output format: base64(IV || ciphertext || authTag)
 * 
 * @param plaintext - String data to encrypt
 * @param key - CryptoKey derived from master password
 * @returns Base64-encoded encrypted data
 */
export async function encrypt(
    plaintext: string,
    key: CryptoKey
): Promise<string> {
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
    const plaintextBytes = new TextEncoder().encode(plaintext);

    const ciphertext = await crypto.subtle.encrypt(
        {
            name: 'AES-GCM',
            iv: iv,
            tagLength: TAG_LENGTH,
        },
        key,
        plaintextBytes
    );

    // Combine IV + ciphertext (includes auth tag)
    const combined = new Uint8Array(iv.length + ciphertext.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(ciphertext), iv.length);

    return uint8ArrayToBase64(combined);
}

/**
 * Decrypts AES-256-GCM encrypted data
 * 
 * @param encryptedBase64 - Base64-encoded encrypted data (IV || ciphertext || authTag)
 * @param key - CryptoKey derived from master password
 * @returns Decrypted plaintext string
 * @throws Error if decryption fails (wrong key or tampered data)
 */
export async function decrypt(
    encryptedBase64: string,
    key: CryptoKey
): Promise<string> {
    const combined = base64ToUint8Array(encryptedBase64);

    // Extract IV and ciphertext
    const iv = combined.slice(0, IV_LENGTH);
    const ciphertext = combined.slice(IV_LENGTH);

    const plaintextBytes = await crypto.subtle.decrypt(
        {
            name: 'AES-GCM',
            iv: iv,
            tagLength: TAG_LENGTH,
        },
        key,
        ciphertext
    );

    return new TextDecoder().decode(plaintextBytes);
}

/**
 * Encrypts a vault item's sensitive data
 * 
 * @param data - Object containing sensitive vault item fields
 * @param key - CryptoKey derived from master password
 * @returns Base64-encoded encrypted JSON
 */
export async function encryptVaultItem(
    data: VaultItemData,
    key: CryptoKey
): Promise<string> {
    const json = JSON.stringify(data);
    return encrypt(json, key);
}

/**
 * Decrypts a vault item's sensitive data
 * 
 * @param encryptedData - Base64-encoded encrypted JSON from database
 * @param key - CryptoKey derived from master password
 * @returns Decrypted vault item data object
 */
export async function decryptVaultItem(
    encryptedData: string,
    key: CryptoKey
): Promise<VaultItemData> {
    const json = await decrypt(encryptedData, key);
    return JSON.parse(json) as VaultItemData;
}

/**
 * Creates a password verification hash for validating unlock attempts
 * This allows checking if the master password is correct without storing it
 * 
 * @param key - Derived CryptoKey
 * @returns Base64-encoded verification hash
 */
export async function createVerificationHash(key: CryptoKey): Promise<string> {
    const verificationData = 'SINGRA_PW_VERIFICATION';
    return encrypt(verificationData, key);
}

/**
 * Verifies that the provided key can decrypt the verification hash
 * 
 * @param verificationHash - Stored verification hash from profile
 * @param key - Derived CryptoKey to test
 * @returns true if the key is correct
 */
export async function verifyKey(
    verificationHash: string,
    key: CryptoKey
): Promise<boolean> {
    try {
        const decrypted = await decrypt(verificationHash, key);
        return decrypted === 'SINGRA_PW_VERIFICATION';
    } catch {
        return false;
    }
}

// ============ KDF Auto-Migration ============

/**
 * Result of a KDF upgrade attempt.
 */
export interface KdfUpgradeResult {
    /** Whether the upgrade succeeded */
    upgraded: boolean;
    /** New CryptoKey derived with upgraded parameters (only if upgraded) */
    newKey?: CryptoKey;
    /** New verification hash (only if upgraded) */
    newVerifier?: string;
    /** The KDF version that is now active */
    activeVersion: number;
}

/**
 * Attempts to upgrade the KDF parameters to the latest version.
 *
 * This is called after a successful unlock. If the user is already on
 * the latest version, returns immediately. Otherwise it:
 *   1. Derives a new key using the latest KDF parameters
 *   2. Creates a new verification hash with the new key
 *   3. Returns the new key + verifier for the caller to persist
 *
 * The caller (VaultContext) is responsible for:
 *   - Saving the new verifier and kdf_version to the profiles table
 *   - Updating the in-memory encryption key
 *   - Updating the offline credentials cache
 *
 * If the device cannot handle the higher memory requirement (OOM),
 * the upgrade is silently skipped and the user stays on the old version.
 *
 * @param masterPassword - The user's master password (still in memory from unlock)
 * @param saltBase64 - The user's encryption salt
 * @param currentVersion - The user's current KDF version from profiles
 * @returns Upgrade result
 */
export async function attemptKdfUpgrade(
    masterPassword: string,
    saltBase64: string,
    currentVersion: number,
): Promise<KdfUpgradeResult> {
    if (currentVersion >= CURRENT_KDF_VERSION) {
        return { upgraded: false, activeVersion: currentVersion };
    }

    try {
        // Derive key with the new, stronger parameters
        const newKey = await deriveKey(masterPassword, saltBase64, CURRENT_KDF_VERSION);

        // Create a new verification hash so future unlocks use the new key
        const newVerifier = await createVerificationHash(newKey);

        return {
            upgraded: true,
            newKey,
            newVerifier,
            activeVersion: CURRENT_KDF_VERSION,
        };
    } catch (err) {
        // If the device runs out of memory (OOM) or the WASM module fails,
        // silently skip the upgrade. The user stays on their current version
        // and can try again on a more capable device.
        console.warn(
            `KDF upgrade from v${currentVersion} to v${CURRENT_KDF_VERSION} failed (likely OOM), staying on v${currentVersion}:`,
            err,
        );
        return { upgraded: false, activeVersion: currentVersion };
    }
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

/**
 * Converts Base64 string to Uint8Array
 */
function base64ToUint8Array(base64: string): Uint8Array {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

// ============ Type Definitions ============

/**
 * Argon2id parameter set for a given KDF version.
 */
export interface KdfParams {
    /** Memory in KiB (e.g. 65536 = 64 MiB) */
    memory: number;
    /** Number of Argon2id iterations */
    iterations: number;
    /** Degree of parallelism (threads) */
    parallelism: number;
    /** Output hash length in bytes */
    hashLength: number;
}

/**
 * Sensitive vault item data that gets encrypted
 */
export interface VaultItemData {
    title?: string;
    websiteUrl?: string;
    itemType?: 'password' | 'note' | 'totp' | 'card';
    isFavorite?: boolean;
    categoryId?: string | null;
    username?: string;
    password?: string;
    notes?: string;
    totpSecret?: string;
    customFields?: Record<string, string>;
    /** Internal marker for duress/decoy items (never exposed to UI) */
    _duress?: boolean;
}

/**
 * Clears sensitive data from memory.
 *
 * SECURITY NOTE: JavaScript strings are immutable and cannot be
 * overwritten in-place.  Setting fields to empty strings removes
 * the reference so the original can be garbage-collected sooner,
 * but the old string content may linger in the heap until the GC
 * reclaims it.  For binary key material, use Uint8Array.fill(0)
 * instead (see deriveKey).
 */
export function secureClear(data: VaultItemData): void {
    if (data.title) data.title = '';
    if (data.websiteUrl) data.websiteUrl = '';
    if (data.itemType) data.itemType = 'password';
    if (typeof data.isFavorite === 'boolean') data.isFavorite = false;
    if (typeof data.categoryId !== 'undefined') data.categoryId = null;
    if (data.username) data.username = '';
    if (data.password) data.password = '';
    if (data.notes) data.notes = '';
    if (data.totpSecret) data.totpSecret = '';
    if (data.customFields) {
        Object.keys(data.customFields).forEach(key => {
            data.customFields![key] = '';
        });
    }
}

// ==========================================
// Asymmetric Encryption for Emergency Access
// ==========================================

export async function generateRSAKeyPair(): Promise<CryptoKeyPair> {
    return window.crypto.subtle.generateKey(
        {
            name: "RSA-OAEP",
            modulusLength: 4096,
            publicExponent: new Uint8Array([1, 0, 1]),
            hash: "SHA-256",
        },
        true,
        ["encrypt", "decrypt"]
    );
}

export async function exportPublicKey(key: CryptoKey): Promise<JsonWebKey> {
    return window.crypto.subtle.exportKey("jwk", key);
}

export async function importPublicKey(jwk: JsonWebKey): Promise<CryptoKey> {
    return window.crypto.subtle.importKey(
        "jwk",
        jwk,
        {
            name: "RSA-OAEP",
            hash: "SHA-256",
        },
        true,
        ["encrypt"]
    );
}

export async function importPrivateKey(jwk: JsonWebKey): Promise<CryptoKey> {
    return window.crypto.subtle.importKey(
        "jwk",
        jwk,
        {
            name: "RSA-OAEP",
            hash: "SHA-256",
        },
        false,
        ["decrypt"]
    );
}

export async function exportPrivateKey(key: CryptoKey): Promise<JsonWebKey> {
    return window.crypto.subtle.exportKey("jwk", key);
}

export async function encryptRSA(
    plaintext: string,
    publicKey: CryptoKey
): Promise<string> {
    const encoded = new TextEncoder().encode(plaintext);
    const encrypted = await window.crypto.subtle.encrypt(
        {
            name: "RSA-OAEP",
        },
        publicKey,
        encoded
    );
    return uint8ArrayToBase64(new Uint8Array(encrypted));
}

export async function decryptRSA(
    ciphertextBase64: string,
    privateKey: CryptoKey
): Promise<string> {
    const encrypted = base64ToUint8Array(ciphertextBase64);
    const decrypted = await window.crypto.subtle.decrypt(
        {
            name: "RSA-OAEP",
        },
        privateKey,
        encrypted as BufferSource
    );
    return new TextDecoder().decode(decrypted);
}

// ==========================================
// Shared Collections Encryption
// ==========================================

/**
 * Generates a user's RSA-4096 key pair for shared collections
 * Private key is encrypted with the master password
 * 
 * @param masterPassword - User's master password
 * @returns Object with public key (JWK) and encrypted private key
 */
export async function generateUserKeyPair(masterPassword: string): Promise<{
    publicKey: string;
    encryptedPrivateKey: string;
}> {
    // 1. Generate RSA-4096 Key Pair
    const keyPair = await crypto.subtle.generateKey(
        {
            name: 'RSA-OAEP',
            modulusLength: 4096,
            publicExponent: new Uint8Array([1, 0, 1]),
            hash: 'SHA-256',
        },
        true,
        ['encrypt', 'decrypt']
    );
    
    // 2. Export Public Key as JWK
    const publicKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
    const publicKey = JSON.stringify(publicKeyJwk);
    
    // 3. Export Private Key as JWK
    const privateKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);
    const privateKey = JSON.stringify(privateKeyJwk);
    
    // 4. Encrypt Private Key with Master Password
    // Generate a temporary salt for this encryption
    const salt = generateSalt();
    const key = await deriveKey(masterPassword, salt);
    const encryptedPrivateKey = await encrypt(privateKey, key);
    
    // Store salt with encrypted key (format: salt:encryptedData)
    const encryptedPrivateKeyWithSalt = `${salt}:${encryptedPrivateKey}`;
    
    return { publicKey, encryptedPrivateKey: encryptedPrivateKeyWithSalt };
}

/**
 * Generates a random shared encryption key for a collection
 * 
 * @returns JWK string of AES-256 key
 */
export async function generateSharedKey(): Promise<string> {
    const key = await crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt']
    );
    
    const keyJwk = await crypto.subtle.exportKey('jwk', key);
    return JSON.stringify(keyJwk);
}

/**
 * Wraps (encrypts) a shared key with a user's public key
 * 
 * @param sharedKey - JWK string of the shared AES key
 * @param publicKey - JWK string of the user's RSA public key
 * @returns Base64-encoded wrapped key
 */
export async function wrapKey(sharedKey: string, publicKey: string): Promise<string> {
    // 1. Import Public Key
    const publicKeyJwk = JSON.parse(publicKey);
    const publicKeyCrypto = await crypto.subtle.importKey(
        'jwk',
        publicKeyJwk,
        { name: 'RSA-OAEP', hash: 'SHA-256' },
        false,
        ['encrypt']
    );
    
    // 2. Encrypt Shared Key
    const sharedKeyBytes = new TextEncoder().encode(sharedKey);
    const wrappedKeyBytes = await crypto.subtle.encrypt(
        { name: 'RSA-OAEP' },
        publicKeyCrypto,
        sharedKeyBytes
    );
    
    // 3. Base64-encode
    return uint8ArrayToBase64(new Uint8Array(wrappedKeyBytes));
}

/**
 * Unwraps (decrypts) a shared key with a user's private key
 * 
 * @param wrappedKey - Base64-encoded wrapped key
 * @param encryptedPrivateKey - Encrypted private key (format: salt:encryptedData)
 * @param masterPassword - User's master password
 * @returns JWK string of the shared AES key
 * @throws Error if decryption fails (wrong password or corrupted key)
 */
export async function unwrapKey(
    wrappedKey: string,
    encryptedPrivateKey: string,
    masterPassword: string
): Promise<string> {
    // 1. Decrypt Private Key
    const [salt, encryptedData] = encryptedPrivateKey.split(':');
    if (!salt || !encryptedData) {
        throw new Error('Invalid encrypted private key format');
    }
    
    const key = await deriveKey(masterPassword, salt);
    const privateKey = await decrypt(encryptedData, key);
    
    // 2. Import Private Key
    const privateKeyJwk = JSON.parse(privateKey);
    const privateKeyCrypto = await crypto.subtle.importKey(
        'jwk',
        privateKeyJwk,
        { name: 'RSA-OAEP', hash: 'SHA-256' },
        false,
        ['decrypt']
    );
    
    // 3. Decrypt Shared Key
    const wrappedKeyBytes = base64ToUint8Array(wrappedKey);
    const sharedKeyBytes = await crypto.subtle.decrypt(
        { name: 'RSA-OAEP' },
        privateKeyCrypto,
        wrappedKeyBytes
    );
    
    return new TextDecoder().decode(sharedKeyBytes);
}

/**
 * Encrypts vault item data with a shared key
 * 
 * @param data - Vault item data to encrypt
 * @param sharedKey - JWK string of the shared AES key
 * @returns Base64-encoded encrypted data
 */
export async function encryptWithSharedKey(
    data: VaultItemData,
    sharedKey: string
): Promise<string> {
    // Import Shared Key
    const keyJwk = JSON.parse(sharedKey);
    const key = await crypto.subtle.importKey(
        'jwk',
        keyJwk,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt']
    );
    
    // Encrypt data
    const json = JSON.stringify(data);
    return encrypt(json, key);
}

/**
 * Decrypts vault item data with a shared key
 * 
 * @param encryptedData - Base64-encoded encrypted data
 * @param sharedKey - JWK string of the shared AES key
 * @returns Decrypted vault item data
 */
export async function decryptWithSharedKey(
    encryptedData: string,
    sharedKey: string
): Promise<VaultItemData> {
    // Import Shared Key
    const keyJwk = JSON.parse(sharedKey);
    const key = await crypto.subtle.importKey(
        'jwk',
        keyJwk,
        { name: 'AES-GCM', length: 256 },
        false,
        ['decrypt']
    );
    
    // Decrypt data
    const json = await decrypt(encryptedData, key);
    return JSON.parse(json) as VaultItemData;
}

/**
 * Encrypts data with a password (used for private key encryption)
 * 
 * @param plaintext - Data to encrypt
 * @param password - Password to derive key from
 * @returns Base64-encoded encrypted data
 */
async function encryptWithPassword(plaintext: string, password: string): Promise<string> {
    const salt = generateSalt();
    const key = await deriveKey(password, salt);
    const encrypted = await encrypt(plaintext, key);
    return `${salt}:${encrypted}`;
}

/**
 * Decrypts data with a password
 * 
 * @param encryptedData - Encrypted data (format: salt:encryptedData)
 * @param password - Password to derive key from
 * @returns Decrypted plaintext
 */
async function decryptWithPassword(encryptedData: string, password: string): Promise<string> {
    const [salt, encrypted] = encryptedData.split(':');
    if (!salt || !encrypted) {
        throw new Error('Invalid encrypted data format');
    }
    
    const key = await deriveKey(password, salt);
    return decrypt(encrypted, key);
}
