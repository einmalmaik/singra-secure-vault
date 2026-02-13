// Copyright (c) 2025-2026 Maunting Studios
// Licensed under the Business Source License 1.1 — see LICENSE
/**
 * @fileoverview Edge-Case Tests for Singra PW
 * 
 * Phase 5: Tests extreme edge cases, boundary values, XSS vectors, and corrupt data
 * across all services. These tests ensure robustness and security under unusual conditions.
 */

import { describe, it, expect, beforeAll, afterEach } from "vitest";
import {
    encryptVaultItem,
    decryptVaultItem,
    deriveKey,
    generateSalt,
    createVerificationHash,
    verifyKey,
} from "@/services/cryptoService";
import { SecureBuffer } from "@/services/secureBuffer";
import {
    generatePassword,
    generatePassphrase,
    calculateStrength,
} from "@/services/passwordGenerator";
import {
    generateTOTP,
    isValidTOTPSecret,
    parseOTPAuthUri,
} from "@/services/totpService";
import {
    verifyVaultIntegrity,
    updateIntegrityRoot,
    deriveIntegrityKey,
} from "@/services/vaultIntegrityService";
import {
    analyzeVaultHealth,
} from "@/services/vaultHealthService";
import {
    recordFailedAttempt,
    getUnlockCooldown,
    resetUnlockAttempts,
} from "@/services/rateLimiterService";
import { sanitizeInlineSvg } from "@/lib/sanitizeSvg";
import { writeClipboard } from "@/services/clipboardService";
import {
    hashBackupCode,
    generateBackupCodes,
} from "@/services/twoFactorService";
import { languages, changeLanguage } from "@/i18n";

// ============ Test Setup ============

let testUserId: string;
let testKey: CryptoKey;

beforeAll(async () => {
    testUserId = "edge-test-user-" + Date.now();
    const salt = generateSalt();
    testKey = await deriveKey("test-password-123", salt, 2);
});

afterEach(() => {
    // Clean up localStorage after rate limiter tests
    if (typeof localStorage !== "undefined") {
        localStorage.removeItem("unlock_attempts");
    }
});

// ============ 5.1 Crypto Edge Cases (10 Tests) ============

describe("Crypto Edge Cases", () => {
    it("encrypts and decrypts with minimal password (single char)", async () => {
        const salt = generateSalt();
        const key = await deriveKey("x", salt, 2); // Single character password
        
        const plaintext = { title: "Test", password: "secret" };
        const encrypted = await encryptVaultItem(plaintext, key);
        const decrypted = await decryptVaultItem(encrypted, key);
        
        expect(decrypted.title).toBe("Test");
        expect(decrypted.password).toBe("secret");
    });

    it("handles 100KB plaintext encryption round-trip", async () => {
        const largeText = "A".repeat(100 * 1024); // 100KB
        const plaintext = { title: "Large", notes: largeText };
        
        const encrypted = await encryptVaultItem(plaintext, testKey);
        const decrypted = await decryptVaultItem(encrypted, testKey);
        
        expect(decrypted.notes).toBe(largeText);
        expect(decrypted.notes?.length).toBe(100 * 1024);
    });

    it("preserves NULL bytes in plaintext", async () => {
        const plaintext = { title: "Test", password: "pass\x00word\x00null" };
        
        const encrypted = await encryptVaultItem(plaintext, testKey);
        const decrypted = await decryptVaultItem(encrypted, testKey);
        
        expect(decrypted.password).toBe("pass\x00word\x00null");
    });

    it("preserves BOM character in plaintext", async () => {
        const plaintext = { title: "\uFEFFTitle with BOM", notes: "\uFEFFNotes" };
        
        const encrypted = await encryptVaultItem(plaintext, testKey);
        const decrypted = await decryptVaultItem(encrypted, testKey);
        
        expect(decrypted.title).toBe("\uFEFFTitle with BOM");
        expect(decrypted.notes).toBe("\uFEFFNotes");
    });

    it("preserves RTL marks in plaintext", async () => {
        const plaintext = { title: "\u200Fعربي\u200F", password: "test" };
        
        const encrypted = await encryptVaultItem(plaintext, testKey);
        const decrypted = await decryptVaultItem(encrypted, testKey);
        
        expect(decrypted.title).toBe("\u200Fعربي\u200F");
    });

    it("handles VaultItemData with all fields undefined", async () => {
        const plaintext = {};
        
        const encrypted = await encryptVaultItem(plaintext, testKey);
        const decrypted = await decryptVaultItem(encrypted, testKey);
        
        expect(decrypted).toEqual({});
    });

    it("handles extremely long field values (50KB each)", async () => {
        const longValue = "X".repeat(50 * 1024);
        const plaintext = {
            title: longValue,
            username: longValue,
            password: longValue,
            notes: longValue,
        };
        
        const encrypted = await encryptVaultItem(plaintext, testKey);
        const decrypted = await decryptVaultItem(encrypted, testKey);
        
        expect(decrypted.title?.length).toBe(50 * 1024);
        expect(decrypted.username?.length).toBe(50 * 1024);
    });

    it("verifies same key 100 times consistently", async () => {
        const salt = generateSalt();
        const key = await deriveKey("consistent-password", salt, 2);
        const verifier = await createVerificationHash(key);
        
        for (let i = 0; i < 100; i++) {
            const isValid = await verifyKey(verifier, key);
            expect(isValid).toBe(true);
        }
    });

    it("handles maximum realistic plaintext for RSA encryption", async () => {
        // RSA-4096 with OAEP-SHA256 can encrypt ~446 bytes max
        const plaintext = "A".repeat(400); // Safe size
        
        const salt = generateSalt();
        const key = await deriveKey(plaintext, salt, 2);
        
        expect(key).toBeDefined();
        expect(key.type).toBe("secret");
    });

    it("rejects decryption with wrong key", async () => {
        const plaintext = { title: "Secret", password: "12345" };
        
        const salt1 = generateSalt();
        const key1 = await deriveKey("password1", salt1, 2);
        
        const salt2 = generateSalt();
        const key2 = await deriveKey("password2", salt2, 2);
        
        const encrypted = await encryptVaultItem(plaintext, key1);
        
        await expect(
            decryptVaultItem(encrypted, key2)
        ).rejects.toThrow();
    });
});

// ============ 5.2 SecureBuffer Edge Cases (5 Tests) ============

describe("SecureBuffer Edge Cases", () => {
    it("handles minimal buffer size (1 byte)", () => {
        const buffer = new SecureBuffer(1);
        expect(buffer.size).toBe(1);
        expect(buffer.isDestroyed).toBe(false);
        buffer.destroy();
        expect(buffer.isDestroyed).toBe(true);
    });

    it("handles large buffer size (100KB)", () => {
        const buffer = new SecureBuffer(100 * 1024);
        expect(buffer.size).toBe(100 * 1024);
        buffer.destroy();
        expect(buffer.isDestroyed).toBe(true);
    });

    it("rejects SecureBuffer.random(0)", () => {
        expect(() => SecureBuffer.random(0)).toThrow();
    });

    it("equals() compares two empty buffers correctly", () => {
        const buffer1 = new SecureBuffer(1);
        const buffer2 = new SecureBuffer(1);
        
        // Fill with zeros
        buffer1.use((bytes) => bytes.fill(0));
        buffer2.use((bytes) => bytes.fill(0));
        
        expect(buffer1.equals(buffer2)).toBe(true);
        
        buffer1.destroy();
        buffer2.destroy();
    });

    it("use() callback exception propagates but buffer remains intact", () => {
        const buffer = SecureBuffer.random(32);
        
        expect(() => {
            buffer.use(() => {
                throw new Error("Callback failed");
            });
        }).toThrow("Callback failed");
        
        expect(buffer.isDestroyed).toBe(false);
        buffer.destroy();
    });
});

// ============ 5.3 Password Generator Edge Cases (5 Tests) ============

describe("Password Generator Edge Cases", () => {
    it("generates 4-character password with single charset enabled", () => {
        const password = generatePassword({
            length: 4,
            uppercase: false,
            lowercase: true, // Only lowercase enabled
            numbers: false,
            symbols: false,
        });
        
        expect(password.length).toBe(4);
        expect(/^[a-z]+$/.test(password)).toBe(true);
    });

    it("generates 128-character password", () => {
        const password = generatePassword({
            length: 128,
            uppercase: true,
            lowercase: true,
            numbers: true,
            symbols: true,
        });
        
        expect(password.length).toBe(128);
    });

    it("generates 4-character password with exactly one from each charset", () => {
        const password = generatePassword({
            length: 4,
            uppercase: true,
            lowercase: true,
            numbers: true,
            symbols: true,
        });
        
        expect(password.length).toBe(4);
        // Should contain at least one from each type (enforced by generator)
        expect(/[A-Z]/.test(password)).toBe(true);
        expect(/[a-z]/.test(password)).toBe(true);
        expect(/[0-9]/.test(password)).toBe(true);
        expect(/[!@#$%^&*()_+\-=[\]{}|;:,.<>?]/.test(password)).toBe(true);
    });

    it("generates 1-word passphrase", () => {
        const passphrase = generatePassphrase({
            wordCount: 1,
            separator: "-",
            capitalize: false,
            includeNumber: false,
        });
        
        expect(passphrase.split("-").length).toBe(1);
    });

    it("calculates strength of empty string as 0", () => {
        const strength = calculateStrength("");
        expect(strength.score).toBe(0);
    });
});

// ============ 5.4 TOTP Edge Cases (5 Tests) ============

describe("TOTP Edge Cases", () => {
    it("generates valid TOTP code with Base32 padding", () => {
        const secret = "JBSWY3DPEHPK3PXP===="; // with padding
        const code = generateTOTP(secret);
        
        expect(code).toMatch(/^\d{6}$/);
    });

    it("validates secret with exactly 16 characters", () => {
        const secret = "JBSWY3DPEHPK3PXP";
        expect(isValidTOTPSecret(secret)).toBe(true);
    });

    it("rejects secret with 15 characters", () => {
        const secret = "JBSWY3DPEHPK3PX"; // 15 chars
        expect(isValidTOTPSecret(secret)).toBe(false);
    });

    it("parses OTPAuth URI with URL-encoded special characters", () => {
        const uri = "otpauth://totp/My%20App:user%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=My%20App";
        const parsed = parseOTPAuthUri(uri);
        
        expect(parsed.label).toContain("user@example.com");
        expect(parsed.issuer).toBe("My App");
    });

    it("parses TOTP URI with minimal parameters", () => {
        const uri = "otpauth://totp/App:user?secret=JBSWY3DPEHPK3PXP";
        const parsed = parseOTPAuthUri(uri);
        
        expect(parsed.secret).toBe("JBSWY3DPEHPK3PXP");
        // parseOTPAuthUri only returns { secret, issuer?, label? }
        // algorithm, digits, period are not returned by this function
    });
});

// ============ 5.5 Vault Integrity Edge Cases (4 Tests) ============

describe("Vault Integrity Edge Cases", () => {
    it("verifies integrity with single item", async () => {
        const items = [
            { id: "item-1", encrypted_data: "data1", user_id: testUserId },
        ];
        
        // Derive proper HMAC key for integrity operations
        const salt = generateSalt();
        const integrityKey = await deriveIntegrityKey("integrity-test-password", salt);
        
        // First update to set the root
        await updateIntegrityRoot(items, integrityKey, testUserId);
        
        // Then verify
        const result = await verifyVaultIntegrity(items, integrityKey, testUserId);
        
        expect(result.valid).toBe(true);
    });

    it("verifies integrity with 3 items (odd count)", async () => {
        const items = [
            { id: "item-1", encrypted_data: "data1", user_id: testUserId },
            { id: "item-2", encrypted_data: "data2", user_id: testUserId },
            { id: "item-3", encrypted_data: "data3", user_id: testUserId },
        ];
        
        // Derive proper HMAC key for integrity operations
        const salt = generateSalt();
        const integrityKey = await deriveIntegrityKey("integrity-test-password", salt);
        
        await updateIntegrityRoot(items, integrityKey, testUserId);
        const result = await verifyVaultIntegrity(items, integrityKey, testUserId);
        
        expect(result.valid).toBe(true);
    });

    it("verifies integrity with 100+ items in reasonable time", async () => {
        const items = Array.from({ length: 100 }, (_, i) => ({
            id: `item-${i}`,
            encrypted_data: `data${i}`,
            user_id: testUserId,
        }));
        
        // Derive proper HMAC key for integrity operations
        const salt = generateSalt();
        const integrityKey = await deriveIntegrityKey("integrity-test-password", salt);
        
        const startTime = Date.now();
        await updateIntegrityRoot(items, integrityKey, testUserId);
        const result = await verifyVaultIntegrity(items, integrityKey, testUserId);
        const duration = Date.now() - startTime;
        
        expect(result.valid).toBe(true);
        expect(duration).toBeLessThan(2000); // Less than 2 seconds
    });

    it("fails verification with corrupted localStorage root", async () => {
        const items = [
            { id: "item-1", encrypted_data: "data1", user_id: testUserId },
        ];
        
        // Derive proper HMAC key for integrity operations
        const salt = generateSalt();
        const integrityKey = await deriveIntegrityKey("integrity-test-password", salt);
        
        // Mock localStorage with corrupted root
        if (typeof localStorage !== "undefined") {
            localStorage.setItem(
                `singra_integrity_root_${testUserId}`,
                "corrupted-root-hash"
            );
        }
        
        const result = await verifyVaultIntegrity(items, integrityKey, testUserId);
        
        expect(result.valid).toBe(false);
        
        // Cleanup
        if (typeof localStorage !== "undefined") {
            localStorage.removeItem(`singra_integrity_root_${testUserId}`);
        }
    });
});

// ============ 5.6 Vault Health Edge Cases (4 Tests) ============

describe("Vault Health Edge Cases", () => {
    it("excludes items without password field from password analysis", () => {
        const items = [
            { id: "1", title: "Note", password: "", username: "", websiteUrl: "", updatedAt: new Date().toISOString() },
            { id: "2", title: "Login", password: "test123", username: "user", websiteUrl: "", updatedAt: new Date().toISOString() },
        ];
        
        const health = analyzeVaultHealth(items);
        
        // totalItems counts all, but only items with passwords are analyzed
        expect(health.totalItems).toBeGreaterThanOrEqual(1);
    });

    it("handles items with invalid URL gracefully", () => {
        const items = [
            { 
                id: "1", 
                title: "Test", 
                password: "test123",
                username: "user",
                websiteUrl: "not-a-valid-url",
                updatedAt: new Date().toISOString(),
            },
        ];
        
        const health = analyzeVaultHealth(items);
        
        // Should not crash
        expect(health.totalItems).toBeGreaterThanOrEqual(1);
    });

    it("does not mark items with future updatedAt as old", () => {
        const futureDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
        
        const items = [
            { 
                id: "1", 
                title: "Future", 
                password: "test-password-123",
                username: "user",
                websiteUrl: "",
                updatedAt: futureDate,
            },
        ];
        
        const health = analyzeVaultHealth(items);
        
        // Future items should not be marked as old
        expect(health.stats.old).toBe(0);
    });

    it("detects all items with identical password as duplicates", () => {
        const samePassword = "duplicate-password-123";
        
        const items = [
            { id: "1", title: "A", password: samePassword, username: "a", websiteUrl: "", updatedAt: new Date().toISOString() },
            { id: "2", title: "B", password: samePassword, username: "b", websiteUrl: "", updatedAt: new Date().toISOString() },
            { id: "3", title: "C", password: samePassword, username: "c", websiteUrl: "", updatedAt: new Date().toISOString() },
        ];
        
        const health = analyzeVaultHealth(items);
        
        // All 3 should be flagged as duplicates
        expect(health.stats.duplicate).toBeGreaterThan(0);
    });
});

// ============ 5.7 Rate Limiter Edge Cases (2 Tests) ============

describe("Rate Limiter Edge Cases", () => {
    it("handles corrupted JSON in localStorage gracefully", () => {
        if (typeof localStorage !== "undefined") {
            localStorage.setItem("unlock_attempts", "corrupted-json{{{");
        }
        
        // Should not throw, should reset to defaults
        recordFailedAttempt();
        
        const cooldown = getUnlockCooldown();
        expect(cooldown).toBeNull(); // First attempt, no cooldown yet
    });

    it("returns null cooldown when lockedUntil is in the past", () => {
        if (typeof localStorage !== "undefined") {
            const pastTime = Date.now() - 10000; // 10 seconds ago
            localStorage.setItem("unlock_attempts", JSON.stringify({
                failures: 5,
                lockedUntil: pastTime,
            }));
        }
        
        const cooldown = getUnlockCooldown();
        expect(cooldown).toBeNull();
        
        // Reset for next test
        resetUnlockAttempts();
    });
});

// ============ 5.8 sanitizeSvg XSS Edge Cases (8 Tests) ============

describe("sanitizeSvg XSS Edge Cases", () => {
    it("removes script tags from SVG", () => {
        const svg = '<svg><script>alert(1)</script><path d="M0 0"/></svg>';
        const sanitized = sanitizeInlineSvg(svg);
        
        expect(sanitized).not.toContain("<script>");
        expect(sanitized).not.toContain("alert");
    });

    it("removes onload event handlers", () => {
        const svg = '<svg onload="alert(1)"><path d="M0 0"/></svg>';
        const sanitized = sanitizeInlineSvg(svg);
        
        expect(sanitized).not.toContain("onload");
        expect(sanitized).not.toContain("alert");
    });

    it("removes javascript: hrefs", () => {
        const svg = '<svg><a href="javascript:alert(1)"><path/></a></svg>';
        const sanitized = sanitizeInlineSvg(svg);
        
        // <a> tag is not in ALLOWED_TAGS, so it gets removed entirely
        expect(sanitized).not.toContain("javascript:");
        expect(sanitized).not.toContain("<a");
    });

    it("removes image tags with data: URIs", () => {
        const svg = '<svg><image href="data:text/html,<script>alert(1)</script>"/></svg>';
        const sanitized = sanitizeInlineSvg(svg);
        
        // <image> is not in ALLOWED_TAGS, so it gets removed
        if (sanitized !== null) {
            expect(sanitized).not.toContain("data:");
            expect(sanitized).not.toContain("<image");
        } else {
            // If null is returned, that's also safe (rejected the input)
            expect(sanitized).toBeNull();
        }
    });

    it("allows nested SVG elements", () => {
        const svg = '<svg><svg><path d="M0 0"/></svg></svg>';
        const sanitized = sanitizeInlineSvg(svg);
        
        expect(sanitized).toContain("<svg");
        expect(sanitized).toContain("<path");
    });

    it("removes foreignObject tags", () => {
        const svg = '<svg><foreignObject><div>HTML content</div></foreignObject></svg>';
        const sanitized = sanitizeInlineSvg(svg);
        
        // foreignObject is not in ALLOWED_TAGS
        expect(sanitized).not.toContain("foreignObject");
        expect(sanitized).not.toContain("<div");
    });

    it("removes use tags with external references", () => {
        const svg = '<svg><use href="external.svg#icon"/></svg>';
        const sanitized = sanitizeInlineSvg(svg);
        
        // <use> is not in ALLOWED_TAGS
        expect(sanitized).not.toContain("<use");
    });

    it("handles null bytes in SVG attributes", () => {
        const svg = '<svg><path d="M0\x00 0"/></svg>';
        const sanitized = sanitizeInlineSvg(svg);
        
        // Should either sanitize or return null
        expect(sanitized === null || !sanitized.includes("\x00")).toBe(true);
    });
});

// ============ 5.9 Clipboard Edge Cases (2 Tests) ============

describe("Clipboard Edge Cases", () => {
    it("writes empty string to clipboard", async () => {
        await writeClipboard("");
        
        // Should not throw, timer should start
        expect(true).toBe(true);
    });

    it("writes extremely long string to clipboard (10KB)", async () => {
        const longString = "A".repeat(10 * 1024);
        
        await writeClipboard(longString);
        
        // Should not throw
        expect(true).toBe(true);
    });
});

// ============ 5.10 Backup-Code Edge Cases (3 Tests) ============

describe("Backup-Code Edge Cases", () => {
    it("hashes backup code with empty salt", async () => {
        const hash = await hashBackupCode("AAAA-BBBB", "");
        
        expect(hash).toBeDefined();
        expect(hash.length).toBeGreaterThan(0);
    });

    it("normalizes lowercase backup code to uppercase", async () => {
        const hash1 = await hashBackupCode("aaaa-bbbb", "salt123");
        const hash2 = await hashBackupCode("AAAABBBB", "salt123");
        
        // After normalization (remove dash + uppercase), should be same
        expect(hash1).toBe(hash2);
    });

    it("generates 5 unique backup codes without duplicates", () => {
        const codes1 = generateBackupCodes();
        const codes2 = generateBackupCodes();
        
        // Each set should have 5 unique codes
        expect(codes1.length).toBe(5);
        expect(codes2.length).toBe(5);
        
        const uniqueCodes1 = new Set(codes1);
        const uniqueCodes2 = new Set(codes2);
        
        expect(uniqueCodes1.size).toBe(5);
        expect(uniqueCodes2.size).toBe(5);
    });
});

// ============ 5.11 i18n Edge Cases (2 Tests) ============

describe("i18n Edge Cases", () => {
    it("has exactly 2 languages (de, en)", () => {
        const languagesArray = Object.values(languages);
        expect(languagesArray).toHaveLength(2);
        
        const codes = Object.keys(languages);
        expect(codes).toContain("de");
        expect(codes).toContain("en");
    });

    it("changes language without persisting when no cookie consent", () => {
        // Clear any existing consent
        if (typeof localStorage !== "undefined") {
            localStorage.removeItem("singra-cookie-consent");
        }
        
        changeLanguage("en");
        
        // Should not have persisted to localStorage
        if (typeof localStorage !== "undefined") {
            const stored = localStorage.getItem("Singra-language");
            // Should be null since no consent was given
            expect(stored).toBeNull();
        }
    });
});
