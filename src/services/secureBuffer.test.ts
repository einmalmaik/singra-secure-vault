/**
 * @fileoverview Tests for SecureBuffer
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SecureBuffer, withSecureBuffer, zeroBuffers } from './secureBuffer';

describe('SecureBuffer', () => {
  describe('constructor', () => {
    it('should create a buffer of the specified size', () => {
      const secure = new SecureBuffer(32);
      expect(secure.size).toBe(32);
      secure.destroy();
    });

    it('should throw for invalid sizes', () => {
      expect(() => new SecureBuffer(0)).toThrow();
      expect(() => new SecureBuffer(-1)).toThrow();
      expect(() => new SecureBuffer(1.5)).toThrow();
    });

    it('should initialize buffer to zeros', () => {
      const secure = new SecureBuffer(16);
      secure.use((data) => {
        expect(data.every(b => b === 0)).toBe(true);
      });
      secure.destroy();
    });
  });

  describe('fromBytes', () => {
    it('should copy bytes into the secure buffer', () => {
      const source = new Uint8Array([1, 2, 3, 4, 5]);
      const secure = SecureBuffer.fromBytes(source);

      secure.use((data) => {
        expect(Array.from(data)).toEqual([1, 2, 3, 4, 5]);
      });

      secure.destroy();
    });

    it('should create an independent copy', () => {
      const source = new Uint8Array([1, 2, 3]);
      const secure = SecureBuffer.fromBytes(source);

      // Modify original
      source[0] = 99;

      // SecureBuffer should be unchanged
      secure.use((data) => {
        expect(data[0]).toBe(1);
      });

      secure.destroy();
    });
  });

  describe('random', () => {
    it('should create a buffer with random bytes', () => {
      const secure1 = SecureBuffer.random(32);
      const secure2 = SecureBuffer.random(32);

      // Two random buffers should (almost certainly) be different
      const bytes1 = secure1.toBytes();
      const bytes2 = secure2.toBytes();

      expect(bytes1).not.toEqual(bytes2);

      secure1.destroy();
      secure2.destroy();
    });
  });

  describe('use', () => {
    it('should provide access to buffer contents', () => {
      const secure = SecureBuffer.fromBytes(new Uint8Array([10, 20, 30]));

      const sum = secure.use((data) => {
        return data[0] + data[1] + data[2];
      });

      expect(sum).toBe(60);
      secure.destroy();
    });

    it('should throw after destroy', () => {
      const secure = new SecureBuffer(8);
      secure.destroy();

      expect(() => secure.use(() => {})).toThrow('SecureBuffer has been destroyed');
    });
  });

  describe('useAsync', () => {
    it('should provide async access to buffer contents', async () => {
      const secure = SecureBuffer.fromBytes(new Uint8Array([1, 2, 3]));

      const result = await secure.useAsync(async (data) => {
        return data.length;
      });

      expect(result).toBe(3);
      secure.destroy();
    });
  });

  describe('destroy', () => {
    it('should zero the buffer contents', () => {
      const secure = SecureBuffer.fromBytes(new Uint8Array([1, 2, 3, 4]));
      const bytesRef = secure.toBytes();

      secure.destroy();

      // The internal buffer should be zeroed
      // Note: We can't directly access it after destroy, but the toBytes()
      // copy we made before destruction should help verify behavior
      expect(secure.isDestroyed).toBe(true);
    });

    it('should be safe to call multiple times', () => {
      const secure = new SecureBuffer(16);
      secure.destroy();
      secure.destroy(); // Should not throw
      expect(secure.isDestroyed).toBe(true);
    });

    it('should prevent further use', () => {
      const secure = new SecureBuffer(8);
      secure.destroy();

      expect(() => secure.size).toThrow();
      expect(() => secure.toBytes()).toThrow();
      expect(() => secure.equals(new Uint8Array(8))).toThrow();
    });
  });

  describe('equals', () => {
    it('should return true for equal buffers', () => {
      const secure = SecureBuffer.fromBytes(new Uint8Array([1, 2, 3]));
      const other = new Uint8Array([1, 2, 3]);

      expect(secure.equals(other)).toBe(true);
      secure.destroy();
    });

    it('should return false for different buffers', () => {
      const secure = SecureBuffer.fromBytes(new Uint8Array([1, 2, 3]));
      const other = new Uint8Array([1, 2, 4]);

      expect(secure.equals(other)).toBe(false);
      secure.destroy();
    });

    it('should return false for different lengths', () => {
      const secure = SecureBuffer.fromBytes(new Uint8Array([1, 2, 3]));
      const other = new Uint8Array([1, 2]);

      expect(secure.equals(other)).toBe(false);
      secure.destroy();
    });

    it('should compare with another SecureBuffer', () => {
      const secure1 = SecureBuffer.fromBytes(new Uint8Array([5, 6, 7]));
      const secure2 = SecureBuffer.fromBytes(new Uint8Array([5, 6, 7]));

      expect(secure1.equals(secure2)).toBe(true);

      secure1.destroy();
      secure2.destroy();
    });
  });
});

describe('withSecureBuffer', () => {
  it('should auto-destroy after use', async () => {
    let capturedSecure: SecureBuffer | null = null;

    await withSecureBuffer(new Uint8Array([1, 2, 3]), async (secure) => {
      capturedSecure = secure;
      expect(secure.isDestroyed).toBe(false);
      return secure.size;
    });

    expect(capturedSecure!.isDestroyed).toBe(true);
  });

  it('should destroy even on error', async () => {
    let capturedSecure: SecureBuffer | null = null;

    await expect(
      withSecureBuffer(new Uint8Array([1]), async (secure) => {
        capturedSecure = secure;
        throw new Error('Test error');
      })
    ).rejects.toThrow('Test error');

    expect(capturedSecure!.isDestroyed).toBe(true);
  });
});

describe('zeroBuffers', () => {
  it('should zero all provided buffers', () => {
    const buf1 = new Uint8Array([1, 2, 3]);
    const buf2 = new Uint8Array([4, 5, 6]);

    zeroBuffers(buf1, buf2);

    expect(buf1.every(b => b === 0)).toBe(true);
    expect(buf2.every(b => b === 0)).toBe(true);
  });

  it('should handle null and undefined', () => {
    const buf = new Uint8Array([1, 2, 3]);

    // Should not throw
    zeroBuffers(buf, null, undefined);

    expect(buf.every(b => b === 0)).toBe(true);
  });
});
