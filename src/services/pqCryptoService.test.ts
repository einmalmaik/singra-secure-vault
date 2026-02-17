// Copyright (c) 2025-2026 Maunting Studios
// Licensed under the Business Source License 1.1 — see LICENSE
/**
 * @fileoverview Tests for Post-Quantum Cryptography Service
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
    generatePQKeyPair,
    generateHybridKeyPair,
    hybridEncrypt,
    hybridDecrypt,
    hybridWrapKey,
    hybridUnwrapKey,
    isHybridEncrypted,
    migrateToHybrid,
    SECURITY_STANDARD_VERSION,
    HYBRID_VERSION,
} from './pqCryptoService';

describe('pqCryptoService', () => {
    describe('generatePQKeyPair', () => {
        it('should generate valid ML-KEM-768 key pair', () => {
            const keys = generatePQKeyPair();
            
            expect(keys.publicKey).toBeDefined();
            expect(keys.secretKey).toBeDefined();
            
            // ML-KEM-768 public key is 1184 bytes
            const pubKeyBytes = atob(keys.publicKey);
            expect(pubKeyBytes.length).toBe(1184);
            
            // ML-KEM-768 secret key is 2400 bytes
            const secKeyBytes = atob(keys.secretKey);
            expect(secKeyBytes.length).toBe(2400);
        });

        it('should generate different keys each time', () => {
            const keys1 = generatePQKeyPair();
            const keys2 = generatePQKeyPair();
            
            expect(keys1.publicKey).not.toBe(keys2.publicKey);
            expect(keys1.secretKey).not.toBe(keys2.secretKey);
        });
    });

    describe('generateHybridKeyPair', () => {
        it('should generate valid hybrid key pair', async () => {
            const keys = await generateHybridKeyPair();
            
            expect(keys.pqPublicKey).toBeDefined();
            expect(keys.pqSecretKey).toBeDefined();
            expect(keys.rsaPublicKey).toBeDefined();
            expect(keys.rsaPrivateKey).toBeDefined();
            
            // RSA keys should be valid JWK
            const rsaPubJwk = JSON.parse(keys.rsaPublicKey);
            expect(rsaPubJwk.kty).toBe('RSA');
            expect(rsaPubJwk.alg).toBe('RSA-OAEP-256');
            
            const rsaPrivJwk = JSON.parse(keys.rsaPrivateKey);
            expect(rsaPrivJwk.kty).toBe('RSA');
            expect(rsaPrivJwk.d).toBeDefined(); // Private exponent
        });
    });

    describe('hybridEncrypt / hybridDecrypt', () => {
        let hybridKeys: Awaited<ReturnType<typeof generateHybridKeyPair>>;
        
        beforeAll(async () => {
            hybridKeys = await generateHybridKeyPair();
        });

        it('should encrypt and decrypt short text', async () => {
            const plaintext = 'Hello, Post-Quantum World!';
            
            const ciphertext = await hybridEncrypt(
                plaintext,
                hybridKeys.pqPublicKey,
                hybridKeys.rsaPublicKey
            );
            
            expect(ciphertext).toBeDefined();
            expect(ciphertext).not.toBe(plaintext);
            
            const decrypted = await hybridDecrypt(
                ciphertext,
                hybridKeys.pqSecretKey,
                hybridKeys.rsaPrivateKey
            );
            
            expect(decrypted).toBe(plaintext);
        });

        it('should encrypt and decrypt long text', async () => {
            const plaintext = 'A'.repeat(10000);
            
            const ciphertext = await hybridEncrypt(
                plaintext,
                hybridKeys.pqPublicKey,
                hybridKeys.rsaPublicKey
            );
            
            const decrypted = await hybridDecrypt(
                ciphertext,
                hybridKeys.pqSecretKey,
                hybridKeys.rsaPrivateKey
            );
            
            expect(decrypted).toBe(plaintext);
        });

        it('should encrypt and decrypt JSON data', async () => {
            const data = {
                username: 'test@example.com',
                password: 'super-secret-password-123!',
                notes: 'Some important notes with special chars: äöü€',
            };
            const plaintext = JSON.stringify(data);
            
            const ciphertext = await hybridEncrypt(
                plaintext,
                hybridKeys.pqPublicKey,
                hybridKeys.rsaPublicKey
            );
            
            const decrypted = await hybridDecrypt(
                ciphertext,
                hybridKeys.pqSecretKey,
                hybridKeys.rsaPrivateKey
            );
            
            expect(JSON.parse(decrypted)).toEqual(data);
        });

        it('should produce different ciphertext for same plaintext', async () => {
            const plaintext = 'Same message';
            
            const ciphertext1 = await hybridEncrypt(
                plaintext,
                hybridKeys.pqPublicKey,
                hybridKeys.rsaPublicKey
            );
            
            const ciphertext2 = await hybridEncrypt(
                plaintext,
                hybridKeys.pqPublicKey,
                hybridKeys.rsaPublicKey
            );
            
            expect(ciphertext1).not.toBe(ciphertext2);
            
            // Both should decrypt to same plaintext
            const decrypted1 = await hybridDecrypt(
                ciphertext1,
                hybridKeys.pqSecretKey,
                hybridKeys.rsaPrivateKey
            );
            const decrypted2 = await hybridDecrypt(
                ciphertext2,
                hybridKeys.pqSecretKey,
                hybridKeys.rsaPrivateKey
            );
            
            expect(decrypted1).toBe(plaintext);
            expect(decrypted2).toBe(plaintext);
        });

        it('should fail with wrong PQ secret key', async () => {
            const plaintext = 'Secret message';
            const wrongKeys = generatePQKeyPair();
            
            const ciphertext = await hybridEncrypt(
                plaintext,
                hybridKeys.pqPublicKey,
                hybridKeys.rsaPublicKey
            );
            
            await expect(hybridDecrypt(
                ciphertext,
                wrongKeys.secretKey, // Wrong PQ key
                hybridKeys.rsaPrivateKey
            )).rejects.toThrow();
        });

        it('should fail with wrong RSA private key', async () => {
            const plaintext = 'Secret message';
            const wrongKeys = await generateHybridKeyPair();
            
            const ciphertext = await hybridEncrypt(
                plaintext,
                hybridKeys.pqPublicKey,
                hybridKeys.rsaPublicKey
            );
            
            await expect(hybridDecrypt(
                ciphertext,
                hybridKeys.pqSecretKey,
                wrongKeys.rsaPrivateKey // Wrong RSA key
            )).rejects.toThrow();
        });

        it('should block legacy hybrid ciphertext versions in runtime decrypt path', async () => {
            const legacyHybrid = btoa(String.fromCharCode(0x02) + 'legacy');

            await expect(hybridDecrypt(
                legacyHybrid,
                hybridKeys.pqSecretKey,
                hybridKeys.rsaPrivateKey
            )).rejects.toThrow('Security Standard v1 requires hybrid ciphertext version 3.');
        });
    });

    describe('hybridWrapKey / hybridUnwrapKey', () => {
        it('should wrap and unwrap shared AES key', async () => {
            const hybridKeys = await generateHybridKeyPair();
            
            // Generate a mock shared AES key
            const mockSharedKey = JSON.stringify({
                kty: 'oct',
                k: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
                alg: 'A256GCM',
            });
            
            const wrapped = await hybridWrapKey(
                mockSharedKey,
                hybridKeys.pqPublicKey,
                hybridKeys.rsaPublicKey
            );
            
            expect(wrapped).toBeDefined();
            
            const unwrapped = await hybridUnwrapKey(
                wrapped,
                hybridKeys.pqSecretKey,
                hybridKeys.rsaPrivateKey
            );
            
            expect(unwrapped).toBe(mockSharedKey);
        });
    });

    describe('isHybridEncrypted', () => {
        it('should return true for hybrid encrypted data', async () => {
            const hybridKeys = await generateHybridKeyPair();
            
            const ciphertext = await hybridEncrypt(
                'test',
                hybridKeys.pqPublicKey,
                hybridKeys.rsaPublicKey
            );
            
            expect(isHybridEncrypted(ciphertext)).toBe(true);
        });

        it('should return false for invalid base64', () => {
            expect(isHybridEncrypted('not-valid-base64!!!')).toBe(false);
        });

        it('should return false for legacy RSA-only format', () => {
            // Version byte 0x01 indicates RSA-only
            const legacyData = btoa(String.fromCharCode(0x01) + 'some-rsa-ciphertext');
            expect(isHybridEncrypted(legacyData)).toBe(false);
        });
    });

    describe('migrateToHybrid', () => {
        it('should return already-hybrid data unchanged', async () => {
            const hybridKeys = await generateHybridKeyPair();
            
            const ciphertext = await hybridEncrypt(
                'test',
                hybridKeys.pqPublicKey,
                hybridKeys.rsaPublicKey
            );
            
            const migrated = await migrateToHybrid(
                ciphertext,
                hybridKeys.rsaPrivateKey,
                hybridKeys.pqSecretKey,
                hybridKeys.pqPublicKey,
                hybridKeys.rsaPublicKey
            );
            
            // Should return same ciphertext since it's already hybrid
            expect(migrated).toBe(ciphertext);
        });
    });

    describe('HYBRID_VERSION constant', () => {
        it('should be version 3', () => {
            expect(HYBRID_VERSION).toBe(3);
        });
    });

    describe('SECURITY_STANDARD_VERSION constant', () => {
        it('should be version 1', () => {
            expect(SECURITY_STANDARD_VERSION).toBe(1);
        });
    });
});
