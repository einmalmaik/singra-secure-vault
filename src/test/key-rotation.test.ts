import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fc from "fast-check";
import { createClient } from "@supabase/supabase-js";

/**
 * Property-Based Test: Key Rotation Preserves Data
 * 
 * Feature: 2fa-encryption-fix
 * Property 2: Round-Trip Encryption Preserves Data
 * Validates: Requirements 3.1, 3.2
 * 
 * This test verifies that for any set of TOTP secrets encrypted with key A,
 * rotating to key B and then decrypting with key B returns the original values.
 */

// Create a Supabase client with service role for testing
const supabaseUrl = process.env.VITE_SUPABASE_URL || "";
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Base32 alphabet (used for TOTP secrets)
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

// Generator for Base32 strings (16-32 characters)
const base32StringArbitrary = fc
  .integer({ min: 16, max: 32 })
  .chain((length) =>
    fc
      .array(fc.constantFrom(...BASE32_ALPHABET.split("")), {
        minLength: length,
        maxLength: length,
      })
      .map((chars) => chars.join(""))
  );

// Generator for 64-character hex keys (32 bytes)
const hexKeyArbitrary = fc
  .array(fc.integer({ min: 0, max: 15 }), {
    minLength: 64,
    maxLength: 64,
  })
  .map((nums) => nums.map((n) => n.toString(16)).join(""));

// Store original key for restoration
let originalKey: string | null = null;

describe("2FA Key Rotation Property Tests", () => {
  beforeAll(async () => {
    // Store the original encryption key
    const { data, error } = await supabase.rpc("get_totp_encryption_key");
    
    if (error) {
      console.error("Failed to get encryption key:", error);
      throw new Error(
        "Encryption key not found. Please ensure the database migrations have been applied."
      );
    }
    
    originalKey = data;
    expect(originalKey).toBeTruthy();
  });

  afterAll(async () => {
    // Restore the original encryption key after all tests
    if (originalKey) {
      try {
        // Clean up any test users first
        await supabase.from("user_2fa").delete().like("user_id", "00000000-0000-0000-0000-%");
        
        // Restore original key using the rotate function
        await supabase.rpc("rotate_totp_encryption_key", {
          p_new_key: originalKey,
        });
      } catch (error) {
        console.error("Failed to restore original key:", error);
      }
    }
  });

  it("should preserve all secrets through key rotation (100+ iterations)", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(base32StringArbitrary, { minLength: 1, maxLength: 10 }),
        hexKeyArbitrary,
        async (totpSecrets, newKey) => {
          // Generate unique test user IDs for this iteration
          const testUserIds = totpSecrets.map((_, index) => 
            `00000000-0000-0000-0000-${String(index).padStart(12, "0")}`
          );

          try {
            // Step 1: Clean up any existing test data
            await supabase
              .from("user_2fa")
              .delete()
              .in("user_id", testUserIds);

            // Step 2: Encrypt secrets with current key (key A)
            const encryptedSecrets: string[] = [];
            for (const secret of totpSecrets) {
              const { data: encrypted, error } = await supabase.rpc(
                "user_2fa_encrypt_secret",
                { _secret: secret }
              );
              
              expect(error).toBeNull();
              expect(encrypted).toBeTruthy();
              encryptedSecrets.push(encrypted as string);
            }

            // Step 3: Insert test users with encrypted secrets
            const insertData = testUserIds.map((userId, index) => ({
              user_id: userId,
              totp_secret_enc: encryptedSecrets[index],
              is_enabled: true,
            }));

            const { error: insertError } = await supabase
              .from("user_2fa")
              .insert(insertData);

            expect(insertError).toBeNull();

            // Step 4: Rotate to new key (key B)
            const { data: rotatedCount, error: rotateError } = await supabase.rpc(
              "rotate_totp_encryption_key",
              { p_new_key: newKey }
            );

            expect(rotateError).toBeNull();
            expect(rotatedCount).toBe(totpSecrets.length);

            // Step 5: Decrypt all secrets with new key and verify
            for (let i = 0; i < totpSecrets.length; i++) {
              const { data: userRecord, error: fetchError } = await supabase
                .from("user_2fa")
                .select("totp_secret_enc")
                .eq("user_id", testUserIds[i])
                .single();

              expect(fetchError).toBeNull();
              expect(userRecord).toBeTruthy();
              expect(userRecord.totp_secret_enc).toBeTruthy();

              // Decrypt with new key
              const { data: decrypted, error: decryptError } = await supabase.rpc(
                "user_2fa_decrypt_secret",
                { _secret_enc: userRecord.totp_secret_enc }
              );

              expect(decryptError).toBeNull();
              expect(decrypted).toBe(totpSecrets[i]);
            }

            // Step 6: Restore original key for next iteration
            if (originalKey) {
              await supabase.rpc("rotate_totp_encryption_key", {
                p_new_key: originalKey,
              });
            }
          } finally {
            // Clean up test data
            await supabase
              .from("user_2fa")
              .delete()
              .in("user_id", testUserIds);
          }
        }
      ),
      {
        numRuns: 100, // Run minimum 100 iterations as specified
        verbose: true,
      }
    );
  }, 300000); // 5 minute timeout for 100+ iterations with database operations

  it("should handle single secret rotation correctly", async () => {
    const testSecret = "JBSWY3DPEHPK3PXP"; // Example Base32 TOTP secret
    const testUserId = "00000000-0000-0000-0000-999999999999";
    const newKey = "a".repeat(64); // Simple test key

    try {
      // Clean up
      await supabase.from("user_2fa").delete().eq("user_id", testUserId);

      // Encrypt with current key
      const { data: encrypted, error: encryptError } = await supabase.rpc(
        "user_2fa_encrypt_secret",
        { _secret: testSecret }
      );

      expect(encryptError).toBeNull();
      expect(encrypted).toBeTruthy();

      // Insert test user
      const { error: insertError } = await supabase.from("user_2fa").insert({
        user_id: testUserId,
        totp_secret_enc: encrypted,
        is_enabled: true,
      });

      expect(insertError).toBeNull();

      // Rotate to new key
      const { data: rotatedCount, error: rotateError } = await supabase.rpc(
        "rotate_totp_encryption_key",
        { p_new_key: newKey }
      );

      expect(rotateError).toBeNull();
      expect(rotatedCount).toBe(1);

      // Fetch and decrypt with new key
      const { data: userRecord } = await supabase
        .from("user_2fa")
        .select("totp_secret_enc")
        .eq("user_id", testUserId)
        .single();

      expect(userRecord).toBeTruthy();

      const { data: decrypted, error: decryptError } = await supabase.rpc(
        "user_2fa_decrypt_secret",
        { _secret_enc: userRecord.totp_secret_enc }
      );

      expect(decryptError).toBeNull();
      expect(decrypted).toBe(testSecret);

      // Restore original key
      if (originalKey) {
        await supabase.rpc("rotate_totp_encryption_key", {
          p_new_key: originalKey,
        });
      }
    } finally {
      // Clean up
      await supabase.from("user_2fa").delete().eq("user_id", testUserId);
    }
  });
});
