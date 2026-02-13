// Copyright (c) 2025-2026 Maunting Studios
// Licensed under the Business Source License 1.1 — see LICENSE
/**
 * @fileoverview Tests for Vault Integrity Service
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    deriveIntegrityKey,
    verifyVaultIntegrity,
    updateIntegrityRoot,
    clearIntegrityRoot,
    hasIntegrityRoot,
    VaultItemForIntegrity,
} from './vaultIntegrityService';

// Mock localStorage
const localStorageMock = (() => {
    let store: Record<string, string> = {};
    return {
        getItem: (key: string) => store[key] || null,
        setItem: (key: string, value: string) => { store[key] = value; },
        removeItem: (key: string) => { delete store[key]; },
        clear: () => { store = {}; },
    };
})();

Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock });

describe('vaultIntegrityService', () => {
    const testUserId = 'test-user-123';
    const testPassword = 'test-master-password';
    const testSalt = 'dGVzdC1zYWx0LWJhc2U2NA=='; // "test-salt-base64" in base64

    let integrityKey: CryptoKey;

    beforeEach(async () => {
        localStorageMock.clear();
        // Derive a test key (this is slow due to Argon2id)
        integrityKey = await deriveIntegrityKey(testPassword, testSalt);
    });

    afterEach(() => {
        localStorageMock.clear();
    });

    describe('deriveIntegrityKey', () => {
        it('should derive a valid HMAC key', async () => {
            const key = await deriveIntegrityKey(testPassword, testSalt);

            expect(key).toBeDefined();
            expect(key.type).toBe('secret');
            expect(key.algorithm.name).toBe('HMAC');
        });

        it('should derive the same key for same inputs', async () => {
            const key1 = await deriveIntegrityKey(testPassword, testSalt);
            const key2 = await deriveIntegrityKey(testPassword, testSalt);

            // We can't directly compare CryptoKeys, but we can verify they
            // produce the same HMAC for the same message
            const message = new TextEncoder().encode('test message');

            const sig1 = await crypto.subtle.sign('HMAC', key1, message);
            const sig2 = await crypto.subtle.sign('HMAC', key2, message);

            expect(new Uint8Array(sig1)).toEqual(new Uint8Array(sig2));
        });

        it('should derive different keys for different passwords', async () => {
            const key1 = await deriveIntegrityKey('password1', testSalt);
            const key2 = await deriveIntegrityKey('password2', testSalt);

            const message = new TextEncoder().encode('test message');

            const sig1 = await crypto.subtle.sign('HMAC', key1, message);
            const sig2 = await crypto.subtle.sign('HMAC', key2, message);

            expect(new Uint8Array(sig1)).not.toEqual(new Uint8Array(sig2));
        });
    });

    describe('verifyVaultIntegrity', () => {
        it('should return isFirstCheck=true when no root is stored', async () => {
            const items: VaultItemForIntegrity[] = [
                { id: 'item-1', encrypted_data: 'encrypted1' },
                { id: 'item-2', encrypted_data: 'encrypted2' },
            ];

            const result = await verifyVaultIntegrity(items, integrityKey, testUserId);

            expect(result.valid).toBe(true);
            expect(result.isFirstCheck).toBe(true);
            expect(result.itemCount).toBe(2);
            expect(result.computedRoot).toBeDefined();
        });

        it('should verify successfully when root matches', async () => {
            const items: VaultItemForIntegrity[] = [
                { id: 'item-1', encrypted_data: 'encrypted1' },
                { id: 'item-2', encrypted_data: 'encrypted2' },
            ];

            // First, store the root
            await updateIntegrityRoot(items, integrityKey, testUserId);

            // Then verify
            const result = await verifyVaultIntegrity(items, integrityKey, testUserId);

            expect(result.valid).toBe(true);
            expect(result.isFirstCheck).toBe(false);
        });

        it('should fail when an item is modified', async () => {
            const items: VaultItemForIntegrity[] = [
                { id: 'item-1', encrypted_data: 'encrypted1' },
                { id: 'item-2', encrypted_data: 'encrypted2' },
            ];

            // Store the root
            await updateIntegrityRoot(items, integrityKey, testUserId);

            // Modify an item
            const modifiedItems = [
                { id: 'item-1', encrypted_data: 'TAMPERED_DATA' },
                { id: 'item-2', encrypted_data: 'encrypted2' },
            ];

            const result = await verifyVaultIntegrity(modifiedItems, integrityKey, testUserId);

            expect(result.valid).toBe(false);
            expect(result.isFirstCheck).toBe(false);
        });

        it('should fail when an item is deleted', async () => {
            const items: VaultItemForIntegrity[] = [
                { id: 'item-1', encrypted_data: 'encrypted1' },
                { id: 'item-2', encrypted_data: 'encrypted2' },
            ];

            await updateIntegrityRoot(items, integrityKey, testUserId);

            // Delete an item
            const reducedItems = [{ id: 'item-1', encrypted_data: 'encrypted1' }];

            const result = await verifyVaultIntegrity(reducedItems, integrityKey, testUserId);

            expect(result.valid).toBe(false);
        });

        it('should fail when an item is added', async () => {
            const items: VaultItemForIntegrity[] = [
                { id: 'item-1', encrypted_data: 'encrypted1' },
            ];

            await updateIntegrityRoot(items, integrityKey, testUserId);

            // Add an item
            const expandedItems = [
                { id: 'item-1', encrypted_data: 'encrypted1' },
                { id: 'item-2', encrypted_data: 'encrypted2' },
            ];

            const result = await verifyVaultIntegrity(expandedItems, integrityKey, testUserId);

            expect(result.valid).toBe(false);
        });

        it('should handle empty vault', async () => {
            const items: VaultItemForIntegrity[] = [];

            await updateIntegrityRoot(items, integrityKey, testUserId);

            const result = await verifyVaultIntegrity(items, integrityKey, testUserId);

            expect(result.valid).toBe(true);
            expect(result.itemCount).toBe(0);
        });

        it('should be order-independent', async () => {
            const items1: VaultItemForIntegrity[] = [
                { id: 'item-a', encrypted_data: 'data-a' },
                { id: 'item-b', encrypted_data: 'data-b' },
                { id: 'item-c', encrypted_data: 'data-c' },
            ];

            await updateIntegrityRoot(items1, integrityKey, testUserId);

            // Verify with different order
            const items2: VaultItemForIntegrity[] = [
                { id: 'item-c', encrypted_data: 'data-c' },
                { id: 'item-a', encrypted_data: 'data-a' },
                { id: 'item-b', encrypted_data: 'data-b' },
            ];

            const result = await verifyVaultIntegrity(items2, integrityKey, testUserId);

            expect(result.valid).toBe(true);
        });
    });

    describe('updateIntegrityRoot', () => {
        it('should store root in localStorage', async () => {
            const items: VaultItemForIntegrity[] = [
                { id: 'item-1', encrypted_data: 'encrypted1' },
            ];

            const root = await updateIntegrityRoot(items, integrityKey, testUserId);

            expect(root).toBeDefined();
            expect(hasIntegrityRoot(testUserId)).toBe(true);
        });

        it('should return the computed root', async () => {
            const items: VaultItemForIntegrity[] = [
                { id: 'item-1', encrypted_data: 'encrypted1' },
            ];

            const root = await updateIntegrityRoot(items, integrityKey, testUserId);

            // Verify it matches what verifyVaultIntegrity computes
            const result = await verifyVaultIntegrity(items, integrityKey, testUserId);

            expect(result.computedRoot).toBe(root);
        });
    });

    describe('clearIntegrityRoot', () => {
        it('should remove the stored root', async () => {
            const items: VaultItemForIntegrity[] = [
                { id: 'item-1', encrypted_data: 'encrypted1' },
            ];

            await updateIntegrityRoot(items, integrityKey, testUserId);
            expect(hasIntegrityRoot(testUserId)).toBe(true);

            clearIntegrityRoot(testUserId);
            expect(hasIntegrityRoot(testUserId)).toBe(false);
        });

        it('should not throw for non-existent root', () => {
            expect(() => clearIntegrityRoot('non-existent-user')).not.toThrow();
        });
    });

    describe('hasIntegrityRoot', () => {
        it('should return false when no root exists', () => {
            expect(hasIntegrityRoot('new-user')).toBe(false);
        });

        it('should return true after root is stored', async () => {
            await updateIntegrityRoot([], integrityKey, testUserId);
            expect(hasIntegrityRoot(testUserId)).toBe(true);
        });
    });
}, 60000); // Increase timeout due to Argon2id operations
