/**
 * @fileoverview Cryptographic Service for Singra PW
 * 
 * Implements zero-knowledge client-side encryption using:
 * - Argon2id for key derivation from master password
 * - AES-256-GCM for authenticated encryption of vault data
 * 
 * SECURITY: The master password NEVER leaves the client.
 * Only encrypted data is stored on the server.
 */

import { argon2id } from 'hash-wasm';

// Argon2id parameters - tuned for ~300ms on modern devices
const ARGON2_MEMORY = 65536; // 64 MiB
const ARGON2_ITERATIONS = 3;
const ARGON2_PARALLELISM = 4;
const ARGON2_HASH_LENGTH = 32; // 256 bits for AES-256

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
 * Derives an AES-256 encryption key from master password using Argon2id
 * 
 * @param masterPassword - The user's master password
 * @param saltBase64 - Base64-encoded salt from profiles table
 * @returns CryptoKey suitable for AES-GCM operations
 */
export async function deriveKey(
    masterPassword: string,
    saltBase64: string
): Promise<CryptoKey> {
    const salt = base64ToUint8Array(saltBase64);

    // Derive raw key bytes using Argon2id via hash-wasm
    const hashHex = await argon2id({
        password: masterPassword,
        salt: salt,
        parallelism: ARGON2_PARALLELISM,
        iterations: ARGON2_ITERATIONS,
        memorySize: ARGON2_MEMORY,
        hashLength: ARGON2_HASH_LENGTH,
        outputType: 'hex',
    });

    // Convert hex to bytes
    const keyBytes = new Uint8Array(hashHex.length / 2);
    for (let i = 0; i < keyBytes.length; i++) {
        keyBytes[i] = parseInt(hashHex.substr(i * 2, 2), 16);
    }

    // Import as CryptoKey for Web Crypto API
    return crypto.subtle.importKey(
        'raw',
        keyBytes,
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
 * Sensitive vault item data that gets encrypted
 */
export interface VaultItemData {
    username?: string;
    password?: string;
    notes?: string;
    totpSecret?: string;
    customFields?: Record<string, string>;
}

/**
 * Clears sensitive data from memory
 * Note: JavaScript doesn't guarantee memory clearing, but this helps
 */
export function secureClear(data: VaultItemData): void {
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
