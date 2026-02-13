// Copyright (c) 2025-2026 Maunting Studios
// Licensed under the Business Source License 1.1 — see LICENSE
/**
 * @fileoverview Integration Tests — Security Services
 *
 * Tests critical security services that protect the vault:
 * - SecureBuffer: memory-safe key handling, use-after-destroy, constant-time compare
 * - RateLimiterService: exponential backoff, grace period, reset
 * - ClipboardService: auto-clearing clipboard
 * - DuressService: decoy marker round-trip, default decoy items
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ============ SecureBuffer Tests ============

import {
  SecureBuffer,
  withSecureBuffer,
  zeroBuffers,
} from "@/services/secureBuffer";

describe("Integration: SecureBuffer — Memory Protection", () => {
  describe("construction and basic operations", () => {
    it("should create a zero-initialized buffer of correct size", () => {
      const buf = new SecureBuffer(32);
      expect(buf.size).toBe(32);
      expect(buf.isDestroyed).toBe(false);

      const bytes = buf.toBytes();
      expect(bytes.every((b) => b === 0)).toBe(true);

      buf.destroy();
    });

    it("should reject invalid sizes", () => {
      expect(() => new SecureBuffer(0)).toThrow("positive integer");
      expect(() => new SecureBuffer(-1)).toThrow("positive integer");
      expect(() => new SecureBuffer(1.5)).toThrow("positive integer");
    });

    it("should create from existing bytes", () => {
      const original = new Uint8Array([1, 2, 3, 4, 5]);
      const buf = SecureBuffer.fromBytes(original);

      const copy = buf.toBytes();
      expect(Array.from(copy)).toEqual([1, 2, 3, 4, 5]);

      // Modifying original should not affect SecureBuffer (it's a copy)
      original[0] = 99;
      const copy2 = buf.toBytes();
      expect(copy2[0]).toBe(1);

      buf.destroy();
    });

    it("should create random buffer", () => {
      const buf = SecureBuffer.random(32);
      expect(buf.size).toBe(32);

      // Random buffer should not be all zeros (astronomically unlikely for 32 bytes)
      const bytes = buf.toBytes();
      const allZero = bytes.every((b) => b === 0);
      expect(allZero).toBe(false);

      buf.destroy();
    });
  });

  describe("controlled access via use()", () => {
    it("should provide access to buffer through callback", () => {
      const buf = SecureBuffer.fromBytes(new Uint8Array([10, 20, 30]));

      const sum = buf.use((data) => data[0] + data[1] + data[2]);
      expect(sum).toBe(60);

      buf.destroy();
    });

    it("should provide async access via useAsync()", async () => {
      const buf = SecureBuffer.fromBytes(new Uint8Array([5, 10, 15]));

      const result = await buf.useAsync(async (data) => {
        return data.reduce((a, b) => a + b, 0);
      });
      expect(result).toBe(30);

      buf.destroy();
    });
  });

  describe("destroy and use-after-destroy detection", () => {
    it("should zero buffer contents on destroy", () => {
      const buf = SecureBuffer.fromBytes(new Uint8Array([0xff, 0xfe, 0xfd]));

      // Get a reference to the internal buffer via use()
      let internalRef: Uint8Array | null = null;
      buf.use((data) => {
        internalRef = data;
      });

      buf.destroy();
      expect(buf.isDestroyed).toBe(true);

      // The internal buffer should be zeroed
      expect(internalRef![0]).toBe(0);
      expect(internalRef![1]).toBe(0);
      expect(internalRef![2]).toBe(0);
    });

    it("should throw on use() after destroy", () => {
      const buf = new SecureBuffer(16);
      buf.destroy();
      expect(() => buf.use((d) => d)).toThrow("destroyed");
    });

    it("should throw on useAsync() after destroy", async () => {
      const buf = new SecureBuffer(16);
      buf.destroy();
      await expect(buf.useAsync(async (d) => d)).rejects.toThrow("destroyed");
    });

    it("should throw on toBytes() after destroy", () => {
      const buf = new SecureBuffer(16);
      buf.destroy();
      expect(() => buf.toBytes()).toThrow("destroyed");
    });

    it("should throw on size access after destroy", () => {
      const buf = new SecureBuffer(16);
      buf.destroy();
      expect(() => buf.size).toThrow("destroyed");
    });

    it("should be safe to call destroy() multiple times", () => {
      const buf = new SecureBuffer(16);
      buf.destroy();
      buf.destroy(); // Should not throw
      expect(buf.isDestroyed).toBe(true);
    });
  });

  describe("constant-time comparison", () => {
    it("should return true for equal buffers", () => {
      const a = SecureBuffer.fromBytes(new Uint8Array([1, 2, 3, 4]));
      const b = SecureBuffer.fromBytes(new Uint8Array([1, 2, 3, 4]));
      expect(a.equals(b)).toBe(true);
      a.destroy();
      b.destroy();
    });

    it("should return false for different buffers", () => {
      const a = SecureBuffer.fromBytes(new Uint8Array([1, 2, 3, 4]));
      const b = SecureBuffer.fromBytes(new Uint8Array([1, 2, 3, 5]));
      expect(a.equals(b)).toBe(false);
      a.destroy();
      b.destroy();
    });

    it("should return false for different length buffers", () => {
      const a = SecureBuffer.fromBytes(new Uint8Array([1, 2, 3]));
      const b = SecureBuffer.fromBytes(new Uint8Array([1, 2, 3, 4]));
      expect(a.equals(b)).toBe(false);
      a.destroy();
      b.destroy();
    });

    it("should accept raw Uint8Array for comparison", () => {
      const a = SecureBuffer.fromBytes(new Uint8Array([10, 20]));
      expect(a.equals(new Uint8Array([10, 20]))).toBe(true);
      expect(a.equals(new Uint8Array([10, 21]))).toBe(false);
      a.destroy();
    });

    it("should throw if destroyed", () => {
      const a = SecureBuffer.fromBytes(new Uint8Array([1]));
      a.destroy();
      expect(() => a.equals(new Uint8Array([1]))).toThrow("destroyed");
    });
  });

  describe("withSecureBuffer helper", () => {
    it("should auto-destroy buffer after async callback", async () => {
      const original = new Uint8Array([42, 43, 44]);
      let captured: SecureBuffer | null = null;

      const result = await withSecureBuffer(original, async (secure) => {
        captured = secure;
        expect(secure.isDestroyed).toBe(false);
        return secure.use((d) => d[0]);
      });

      expect(result).toBe(42);
      expect(captured!.isDestroyed).toBe(true);
    });

    it("should destroy buffer even if callback throws", async () => {
      let captured: SecureBuffer | null = null;

      await expect(
        withSecureBuffer(new Uint8Array([1]), async (secure) => {
          captured = secure;
          throw new Error("intentional");
        })
      ).rejects.toThrow("intentional");

      expect(captured!.isDestroyed).toBe(true);
    });
  });

  describe("zeroBuffers helper", () => {
    it("should zero multiple buffers", () => {
      const a = new Uint8Array([1, 2, 3]);
      const b = new Uint8Array([4, 5, 6]);
      zeroBuffers(a, b);
      expect(a.every((v) => v === 0)).toBe(true);
      expect(b.every((v) => v === 0)).toBe(true);
    });

    it("should handle null and undefined gracefully", () => {
      const a = new Uint8Array([1, 2]);
      zeroBuffers(a, null, undefined);
      expect(a.every((v) => v === 0)).toBe(true);
    });
  });
});

// ============ Rate Limiter Tests ============

import {
  getUnlockCooldown,
  recordFailedAttempt,
  resetUnlockAttempts,
  getFailedAttemptCount,
} from "@/services/rateLimiterService";

describe("Integration: RateLimiterService — Brute-force Mitigation", () => {
  beforeEach(() => {
    resetUnlockAttempts();
    vi.useFakeTimers();
  });

  afterEach(() => {
    resetUnlockAttempts();
    vi.useRealTimers();
  });

  it("should start with no cooldown and zero failures", () => {
    expect(getUnlockCooldown()).toBeNull();
    expect(getFailedAttemptCount()).toBe(0);
  });

  it("should allow 3 grace attempts without lockout", () => {
    recordFailedAttempt(); // 1
    recordFailedAttempt(); // 2
    recordFailedAttempt(); // 3
    expect(getFailedAttemptCount()).toBe(3);
    expect(getUnlockCooldown()).toBeNull(); // No lockout yet
  });

  it("should lock after 4th attempt with 5s delay", () => {
    for (let i = 0; i < 4; i++) recordFailedAttempt();
    const cooldown = getUnlockCooldown();
    expect(cooldown).not.toBeNull();
    expect(cooldown!).toBeLessThanOrEqual(5000);
    expect(cooldown!).toBeGreaterThan(0);
  });

  it("should implement exponential backoff", () => {
    // Record 4 failures (first lockout)
    for (let i = 0; i < 4; i++) recordFailedAttempt();
    const delay4 = getUnlockCooldown();

    // Wait out the lockout and add more failures
    vi.advanceTimersByTime(6000);
    recordFailedAttempt(); // 5th failure
    const delay5 = getUnlockCooldown();

    vi.advanceTimersByTime(11000);
    recordFailedAttempt(); // 6th failure
    const delay6 = getUnlockCooldown();

    // Delays should increase: 5s, 10s, 20s
    expect(delay5!).toBeGreaterThan(delay4!);
    expect(delay6!).toBeGreaterThan(delay5!);
  });

  it("should cap delay at 30 minutes", () => {
    // Record many failures to hit cap
    for (let i = 0; i < 20; i++) {
      vi.advanceTimersByTime(30 * 60 * 1000 + 1000); // skip past any lockout
      recordFailedAttempt();
    }
    const cooldown = getUnlockCooldown();
    expect(cooldown).not.toBeNull();
    expect(cooldown!).toBeLessThanOrEqual(30 * 60 * 1000);
  });

  it("should reset to zero after successful unlock", () => {
    for (let i = 0; i < 5; i++) recordFailedAttempt();
    expect(getFailedAttemptCount()).toBe(5);
    expect(getUnlockCooldown()).not.toBeNull();

    resetUnlockAttempts();
    expect(getFailedAttemptCount()).toBe(0);
    expect(getUnlockCooldown()).toBeNull();
  });

  it("should expire lockout naturally", () => {
    for (let i = 0; i < 4; i++) recordFailedAttempt();
    expect(getUnlockCooldown()).not.toBeNull();

    // Advance past 5 second lockout
    vi.advanceTimersByTime(6000);
    expect(getUnlockCooldown()).toBeNull();
  });
});

// ============ Clipboard Service Tests ============

import { writeClipboard } from "@/services/clipboardService";

describe("Integration: ClipboardService — Auto-clearing", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should write text to clipboard", async () => {
    await writeClipboard("my-secret-password");
    const content = await navigator.clipboard.readText();
    expect(content).toBe("my-secret-password");
  });

  it("should auto-clear clipboard after 30 seconds", async () => {
    await writeClipboard("auto-clear-me");

    // Verify content is present
    let content = await navigator.clipboard.readText();
    expect(content).toBe("auto-clear-me");

    // Advance timer past 30 seconds
    await vi.advanceTimersByTimeAsync(31_000);

    content = await navigator.clipboard.readText();
    expect(content).toBe("");
  });

  it("should not clear clipboard if overwritten by user", async () => {
    await writeClipboard("original-secret");

    // Simulate user copying something else
    await navigator.clipboard.writeText("user-content");

    // Advance timer past 30 seconds
    await vi.advanceTimersByTimeAsync(31_000);

    // User content should be preserved
    const content = await navigator.clipboard.readText();
    expect(content).toBe("user-content");
  });

  it("should cancel previous timer on new copy", async () => {
    await writeClipboard("first");

    // Advance 20 seconds (not yet cleared)
    await vi.advanceTimersByTimeAsync(20_000);

    // Copy something new (resets timer)
    await writeClipboard("second");

    // Advance 20 more seconds (40 total, but only 20 since "second")
    await vi.advanceTimersByTimeAsync(20_000);

    // "second" should still be there (timer restarted)
    const content = await navigator.clipboard.readText();
    expect(content).toBe("second");

    // Advance remaining 11 seconds
    await vi.advanceTimersByTimeAsync(11_000);

    const cleared = await navigator.clipboard.readText();
    expect(cleared).toBe("");
  });
});

// ============ Duress Marker Tests ============

import {
  isDecoyItem,
  markAsDecoyItem,
  stripDecoyMarker,
  getDefaultDecoyItems,
  DURESS_MARKER_FIELD,
} from "@/services/duressService";

describe("Integration: DuressService — Decoy Item Markers", () => {
  it("should mark an item as decoy and detect it", () => {
    const item = { title: "Gmail", username: "user@test.com", password: "pw" };
    const marked = markAsDecoyItem(item);

    expect(marked._duress).toBe(true);
    expect(marked[DURESS_MARKER_FIELD]).toBe(true);
    expect(isDecoyItem(marked)).toBe(true);
  });

  it("should not detect regular items as decoy", () => {
    const item = { title: "Regular", password: "secret" };
    expect(isDecoyItem(item)).toBe(false);
  });

  it("should strip decoy marker for display", () => {
    const marked = markAsDecoyItem({ title: "Test", password: "pw" });
    const stripped = stripDecoyMarker(marked);

    expect("_duress" in stripped).toBe(false);
    expect(stripped.title).toBe("Test");
    expect(stripped.password).toBe("pw");
  });

  it("should round-trip marker: mark -> strip -> not decoy", () => {
    const original = { title: "Item", username: "user" };
    const marked = markAsDecoyItem(original);
    expect(isDecoyItem(marked)).toBe(true);

    const stripped = stripDecoyMarker(marked);
    expect(isDecoyItem(stripped)).toBe(false);
    expect(stripped).toEqual(original);
  });

  it("should provide realistic default decoy items", () => {
    const decoys = getDefaultDecoyItems();
    expect(decoys.length).toBeGreaterThanOrEqual(3);

    for (const decoy of decoys) {
      expect(decoy.title).toBeTruthy();
      expect(decoy.username).toBeTruthy();
      expect(decoy.password).toBeTruthy();
    }
  });

  it("should return deep copies of default decoy items", () => {
    const a = getDefaultDecoyItems();
    const b = getDefaultDecoyItems();

    // Modify a, should not affect b
    a[0].title = "MODIFIED";
    expect(b[0].title).not.toBe("MODIFIED");
  });
});
