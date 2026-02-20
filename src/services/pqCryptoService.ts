// Copyright (c) 2025-2026 Maunting Studios
// Licensed under the Business Source License 1.1 — see LICENSE
/**
 * @fileoverview Post-Quantum Cryptography Service for Singra Vault.
 *
 * Implements hybrid encryption combining:
 * - ML-KEM-768 (FIPS 203) for post-quantum key encapsulation
 * - RSA-4096-OAEP for classical encryption
 *
 * This protects against "harvest now, decrypt later" attacks where
 * adversaries collect encrypted data today to decrypt with future
 * quantum computers.
 *
 * SECURITY STANDARD V1:
 * - New ciphertexts are written with version byte 0x03.
 * - Runtime decrypt paths accept only v1 ciphertexts.
 * - Legacy migration helpers can still convert old formats.
 *
 * @see https://nvlpubs.nist.gov/nistpubs/FIPS/NIST.FIPS.203.pdf
 */

import { ml_kem768 } from '@noble/post-quantum/ml-kem.js';
import { SECURITY_STANDARD_VERSION } from '@/services/securityStandard';

// ============ Constants ============

/** Product security standard version */
export { SECURITY_STANDARD_VERSION };

/** Current hybrid ciphertext version for Security Standard v1 */
export const HYBRID_VERSION = 3;

/** Version byte for legacy RSA-only encryption */
const VERSION_RSA_ONLY = 0x01;

/** Version byte for legacy hybrid ML-KEM + RSA encryption */
const VERSION_HYBRID_LEGACY = 0x02;

/** Version byte for Security Standard v1 hybrid ML-KEM + RSA encryption */
const VERSION_HYBRID_STANDARD_V1 = 0x03;

/** ML-KEM-768 ciphertext size in bytes */
const ML_KEM_768_CIPHERTEXT_SIZE = 1088;

/** ML-KEM-768 public key size in bytes */
const ML_KEM_768_PUBLIC_KEY_SIZE = 1184;

/** ML-KEM-768 secret key size in bytes */
const ML_KEM_768_SECRET_KEY_SIZE = 2400;

/** ML-KEM-768 shared secret size in bytes */
const ML_KEM_768_SHARED_SECRET_SIZE = 32;

/** HKDF info prefix for hybrid key combination */
const HYBRID_KDF_INFO_PREFIX = new TextEncoder().encode('Singra Vault-HybridKDF-v1:');

// ============ Key Generation ============

/**
 * Generates a new ML-KEM-768 key pair.
 * 
 * @returns Object with base64-encoded public and secret keys
 */
export function generatePQKeyPair(): PQKeyPair {
    const seed = crypto.getRandomValues(new Uint8Array(64));
    const { publicKey, secretKey } = ml_kem768.keygen(seed);
    
    // Zero the seed immediately
    seed.fill(0);
    
    return {
        publicKey: uint8ArrayToBase64(publicKey),
        secretKey: uint8ArrayToBase64(secretKey),
    };
}

/**
 * Generates a hybrid key pair combining ML-KEM-768 and RSA-4096.
 * 
 * @returns Object with both PQ and RSA keys
 */
export async function generateHybridKeyPair(): Promise<HybridKeyPair> {
    // Generate ML-KEM-768 key pair
    const pqKeys = generatePQKeyPair();
    
    // Generate RSA-4096 key pair
    const rsaKeyPair = await crypto.subtle.generateKey(
        {
            name: 'RSA-OAEP',
            modulusLength: 4096,
            publicExponent: new Uint8Array([1, 0, 1]),
            hash: 'SHA-256',
        },
        true,
        ['encrypt', 'decrypt']
    );
    
    const rsaPublicJwk = await crypto.subtle.exportKey('jwk', rsaKeyPair.publicKey);
    const rsaPrivateJwk = await crypto.subtle.exportKey('jwk', rsaKeyPair.privateKey);
    
    return {
        pqPublicKey: pqKeys.publicKey,
        pqSecretKey: pqKeys.secretKey,
        rsaPublicKey: JSON.stringify(rsaPublicJwk),
        rsaPrivateKey: JSON.stringify(rsaPrivateJwk),
    };
}

// ============ Hybrid Encryption ============

/**
 * Encrypts data using hybrid ML-KEM-768 + RSA-4096-OAEP encryption.
 * 
 * The plaintext is encrypted with a randomly generated AES-256 key.
 * This AES key is then encapsulated/encrypted with both:
 * 1. ML-KEM-768 (post-quantum secure)
 * 2. RSA-4096-OAEP (classically secure)
 * 
 * Format: version(1) || pq_ciphertext(1088) || rsa_ciphertext(512) || aes_ciphertext(variable)
 * 
 * @param plaintext - Data to encrypt
 * @param pqPublicKey - Base64-encoded ML-KEM-768 public key
 * @param rsaPublicKey - JWK string of RSA-4096 public key
 * @returns Base64-encoded hybrid ciphertext
 */
export async function hybridEncrypt(
    plaintext: string,
    pqPublicKey: string,
    rsaPublicKey: string
): Promise<string> {
    // 1. Generate random AES-256 key (32 bytes)
    const aesKeyBytes = crypto.getRandomValues(new Uint8Array(32));
    
    // 2. Encapsulate with ML-KEM-768
    const pqPubKeyBytes = base64ToUint8Array(pqPublicKey);
    const { cipherText: pqCiphertext, sharedSecret: pqSharedSecret } = 
        ml_kem768.encapsulate(pqPubKeyBytes);
    
    // 3. Encrypt AES key with RSA-OAEP
    const rsaPubKeyJwk = JSON.parse(rsaPublicKey);
    const rsaPubKey = await crypto.subtle.importKey(
        'jwk',
        rsaPubKeyJwk,
        { name: 'RSA-OAEP', hash: 'SHA-256' },
        false,
        ['encrypt']
    );
    
    const rsaCiphertext = await crypto.subtle.encrypt(
        { name: 'RSA-OAEP' },
        rsaPubKey,
        aesKeyBytes
    );

    const rsaCiphertextBytes = new Uint8Array(rsaCiphertext);
    const combinedKey = await deriveHybridCombinedKey(
        pqSharedSecret,
        aesKeyBytes,
        rsaCiphertextBytes,
    );
    
    // 5. Encrypt plaintext with combined AES key
    const aesKey = await crypto.subtle.importKey(
        'raw',
        combinedKey,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt']
    );
    
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plaintextBytes = new TextEncoder().encode(plaintext);
    const aesCiphertext = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv, tagLength: 128 },
        aesKey,
        plaintextBytes
    );
    
    // 6. Zero sensitive data
    aesKeyBytes.fill(0);
    pqSharedSecret.fill(0);
    combinedKey.fill(0);
    
    // 7. Combine: version || pq_ciphertext || rsa_ciphertext || iv || aes_ciphertext
    const aesCiphertextBytes = new Uint8Array(aesCiphertext);
    
    const totalLength = 1 + pqCiphertext.length + rsaCiphertextBytes.length + 
                        iv.length + aesCiphertextBytes.length;
    const combined = new Uint8Array(totalLength);
    
    let offset = 0;
    combined[offset++] = VERSION_HYBRID_STANDARD_V1;
    combined.set(pqCiphertext, offset);
    offset += pqCiphertext.length;
    combined.set(rsaCiphertextBytes, offset);
    offset += rsaCiphertextBytes.length;
    combined.set(iv, offset);
    offset += iv.length;
    combined.set(aesCiphertextBytes, offset);
    
    return uint8ArrayToBase64(combined);
}

/**
 * Decrypts hybrid ML-KEM-768 + RSA-4096-OAEP encrypted data.
 * 
 * @param ciphertextBase64 - Base64-encoded hybrid ciphertext
 * @param pqSecretKey - Base64-encoded ML-KEM-768 secret key
 * @param rsaPrivateKey - JWK string of RSA-4096 private key
 * @returns Decrypted plaintext
 * @throws Error if decryption fails or version is unsupported
 */
export async function hybridDecrypt(
    ciphertextBase64: string,
    pqSecretKey: string,
    rsaPrivateKey: string
): Promise<string> {
    return decryptHybridCiphertext(ciphertextBase64, pqSecretKey, rsaPrivateKey, false);
}

/**
 * Legacy RSA-only decryption for backward compatibility.
 * Used when decrypting data encrypted before PQ upgrade.
 */
async function legacyRsaDecrypt(
    ciphertext: Uint8Array,
    rsaPrivateKey: string
): Promise<string> {
    const rsaPrivKeyJwk = JSON.parse(rsaPrivateKey);
    const rsaPrivKey = await crypto.subtle.importKey(
        'jwk',
        rsaPrivKeyJwk,
        { name: 'RSA-OAEP', hash: 'SHA-256' },
        false,
        ['decrypt']
    );
    
    const plaintextBytes = await crypto.subtle.decrypt(
        { name: 'RSA-OAEP' },
        rsaPrivKey,
        ciphertext
    );
    
    return new TextDecoder().decode(plaintextBytes);
}

// ============ Key Wrapping for Shared Collections ============

/**
 * Wraps a shared AES key using hybrid encryption.
 * Used for shared collections where each member gets a wrapped copy.
 * 
 * @param sharedKeyJwk - JWK string of the shared AES-256 key
 * @param pqPublicKey - Base64-encoded ML-KEM-768 public key
 * @param rsaPublicKey - JWK string of RSA-4096 public key
 * @returns Base64-encoded wrapped key
 */
export async function hybridWrapKey(
    sharedKeyJwk: string,
    pqPublicKey: string,
    rsaPublicKey: string
): Promise<string> {
    return hybridEncrypt(sharedKeyJwk, pqPublicKey, rsaPublicKey);
}

/**
 * Unwraps a shared AES key using hybrid decryption.
 * 
 * @param wrappedKey - Base64-encoded wrapped key
 * @param pqSecretKey - Base64-encoded ML-KEM-768 secret key
 * @param rsaPrivateKey - JWK string of RSA-4096 private key
 * @returns JWK string of the shared AES-256 key
 */
export async function hybridUnwrapKey(
    wrappedKey: string,
    pqSecretKey: string,
    rsaPrivateKey: string
): Promise<string> {
    return hybridDecrypt(wrappedKey, pqSecretKey, rsaPrivateKey);
}

// ============ Migration Helpers ============

/**
 * Checks if a ciphertext uses hybrid (post-quantum) encryption.
 * 
 * @param ciphertextBase64 - Base64-encoded ciphertext
 * @returns true if hybrid encryption, false if legacy RSA-only
 */
export function isHybridEncrypted(ciphertextBase64: string): boolean {
    try {
        const combined = base64ToUint8Array(ciphertextBase64);
        return combined[0] === VERSION_HYBRID_STANDARD_V1;
    } catch {
        return false;
    }
}

/**
 * Re-encrypts legacy RSA-only data with hybrid encryption.
 * Used during migration to post-quantum security.
 * 
 * @param legacyCiphertext - Base64-encoded legacy ciphertext (RSA-only)
 * @param rsaPrivateKey - JWK string of RSA private key for decryption
 * @param pqPublicKey - Base64-encoded ML-KEM-768 public key
 * @param rsaPublicKey - JWK string of RSA public key
 * @returns Base64-encoded hybrid ciphertext
 */
export async function migrateToHybrid(
    legacyCiphertext: string,
    rsaPrivateKey: string,
    pqSecretKey: string | null,
    pqPublicKey: string,
    rsaPublicKey: string
): Promise<string> {
    const combined = base64ToUint8Array(legacyCiphertext);
    const version = combined[0];

    if (version === VERSION_HYBRID_STANDARD_V1) {
        return legacyCiphertext;
    }

    let plaintext: string;
    if (version === VERSION_RSA_ONLY) {
        plaintext = await legacyRsaDecrypt(combined.slice(1), rsaPrivateKey);
    } else if (version === VERSION_HYBRID_LEGACY) {
        if (!pqSecretKey) {
            throw new Error('PQ secret key is required to migrate legacy hybrid ciphertext.');
        }

        plaintext = await decryptHybridCiphertext(
            legacyCiphertext,
            pqSecretKey,
            rsaPrivateKey,
            true,
        );
    } else {
        // Very old format without version byte - assume raw RSA ciphertext
        plaintext = await legacyRsaDecrypt(combined, rsaPrivateKey);
    }

    return hybridEncrypt(plaintext, pqPublicKey, rsaPublicKey);
}

// ============ Utility Functions ============

function uint8ArrayToBase64(bytes: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

function base64ToUint8Array(base64: string): Uint8Array {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

function concatUint8Arrays(first: Uint8Array, second: Uint8Array): Uint8Array {
    const combined = new Uint8Array(first.length + second.length);
    combined.set(first, 0);
    combined.set(second, first.length);
    return combined;
}

async function deriveHybridCombinedKey(
    pqSharedSecret: Uint8Array,
    aesKeyBytes: Uint8Array,
    rsaCiphertext: Uint8Array,
): Promise<Uint8Array> {
    const baseKey = await crypto.subtle.importKey(
        'raw',
        pqSharedSecret,
        'HKDF',
        false,
        ['deriveBits'],
    );

    const info = concatUint8Arrays(HYBRID_KDF_INFO_PREFIX, rsaCiphertext);
    try {
        const derivedBits = await crypto.subtle.deriveBits(
            {
                name: 'HKDF',
                hash: 'SHA-256',
                salt: aesKeyBytes,
                info,
            },
            baseKey,
            256,
        );

        return new Uint8Array(derivedBits);
    } finally {
        info.fill(0);
    }
}

async function decryptHybridCiphertext(
    ciphertextBase64: string,
    pqSecretKey: string,
    rsaPrivateKey: string,
    allowLegacyFormats: boolean,
): Promise<string> {
    const combined = base64ToUint8Array(ciphertextBase64);
    const version = combined[0];

    if (!allowLegacyFormats && version !== VERSION_HYBRID_STANDARD_V1) {
        throw new Error('Security Standard v1 requires hybrid ciphertext version 3.');
    }

    if (version === VERSION_RSA_ONLY) {
        if (!allowLegacyFormats) {
            throw new Error('RSA-only ciphertext is blocked by Security Standard v1.');
        }

        return legacyRsaDecrypt(combined.slice(1), rsaPrivateKey);
    }

    if (version !== VERSION_HYBRID_STANDARD_V1 && version !== VERSION_HYBRID_LEGACY) {
        throw new Error(`Unsupported encryption version: ${version}`);
    }

    const { pqCiphertext, rsaCiphertext, iv, aesCiphertext } = parseHybridCiphertext(combined);

    // Decapsulate ML-KEM-768 shared secret.
    const pqSecretKeyBytes = base64ToUint8Array(pqSecretKey);
    const pqSharedSecret = ml_kem768.decapsulate(pqCiphertext, pqSecretKeyBytes);

    // Decrypt AES key with RSA-OAEP.
    const rsaPrivKeyJwk = JSON.parse(rsaPrivateKey);
    const rsaPrivKey = await crypto.subtle.importKey(
        'jwk',
        rsaPrivKeyJwk,
        { name: 'RSA-OAEP', hash: 'SHA-256' },
        false,
        ['decrypt']
    );

    const aesKeyBytes = new Uint8Array(await crypto.subtle.decrypt(
        { name: 'RSA-OAEP' },
        rsaPrivKey,
        rsaCiphertext
    ));

    const combinedKey = await deriveHybridCombinedKey(
        pqSharedSecret,
        aesKeyBytes,
        rsaCiphertext,
    );

    // Decrypt plaintext with combined AES key.
    const aesKey = await crypto.subtle.importKey(
        'raw',
        combinedKey,
        { name: 'AES-GCM', length: 256 },
        false,
        ['decrypt']
    );

    try {
        const plaintextBytes = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv, tagLength: 128 },
            aesKey,
            aesCiphertext
        );

        return new TextDecoder().decode(plaintextBytes);
    } finally {
        aesKeyBytes.fill(0);
        pqSharedSecret.fill(0);
        combinedKey.fill(0);
    }
}

function parseHybridCiphertext(combined: Uint8Array): ParsedHybridCiphertext {
    let offset = 1;

    const pqCiphertext = combined.slice(offset, offset + ML_KEM_768_CIPHERTEXT_SIZE);
    offset += ML_KEM_768_CIPHERTEXT_SIZE;

    const rsaCiphertext = combined.slice(offset, offset + 512);
    offset += 512;

    const iv = combined.slice(offset, offset + 12);
    offset += 12;

    const aesCiphertext = combined.slice(offset);

    return { pqCiphertext, rsaCiphertext, iv, aesCiphertext };
}

// ============ Type Definitions ============

/**
 * ML-KEM-768 key pair
 */
export interface PQKeyPair {
    /** Base64-encoded ML-KEM-768 public key (1184 bytes) */
    publicKey: string;
    /** Base64-encoded ML-KEM-768 secret key (2400 bytes) */
    secretKey: string;
}

/**
 * Combined hybrid key pair with both PQ and classical keys
 */
export interface HybridKeyPair {
    /** Base64-encoded ML-KEM-768 public key */
    pqPublicKey: string;
    /** Base64-encoded ML-KEM-768 secret key */
    pqSecretKey: string;
    /** JWK string of RSA-4096 public key */
    rsaPublicKey: string;
    /** JWK string of RSA-4096 private key */
    rsaPrivateKey: string;
}

interface ParsedHybridCiphertext {
    pqCiphertext: Uint8Array;
    rsaCiphertext: Uint8Array;
    iv: Uint8Array;
    aesCiphertext: Uint8Array;
}
