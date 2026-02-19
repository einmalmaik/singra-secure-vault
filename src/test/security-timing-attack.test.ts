// Copyright (c) 2025-2026 Maunting Studios
// Licensed under the Business Source License 1.1 - see LICENSE
/**
 * @fileoverview Security test for timing-attack prevention behavior
 *
 * CRITICAL: Validate constant-structure execution for dual unlock:
 * - Always derives two keys (real + duress/dummy)
 * - Uses correct KDF versions for each path
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const deriveKeyMock = vi.hoisted(() => vi.fn(async () => ({} as CryptoKey)));
const verifyKeyMock = vi.hoisted(() => vi.fn(async () => false));

vi.mock('@/services/cryptoService', async () => {
  const actual = await vi.importActual<typeof import('@/services/cryptoService')>('@/services/cryptoService');
  return {
    ...actual,
    deriveKey: deriveKeyMock,
    verifyKey: verifyKeyMock,
  };
});

import { attemptDualUnlock, DuressConfig } from '@/services/duressService';

describe('Timing Attack Prevention Tests', () => {
  beforeEach(() => {
    deriveKeyMock.mockClear();
    verifyKeyMock.mockClear();
  });

  it('should derive real and duress keys with their respective KDF versions', async () => {
    const duressConfig: DuressConfig = {
      enabled: true,
      salt: 'duress-salt',
      verifier: 'duress-verifier',
      kdfVersion: 2,
    };

    await attemptDualUnlock(
      'Password123!',
      'real-salt',
      'real-verifier',
      1,
      duressConfig
    );

    expect(deriveKeyMock).toHaveBeenCalledTimes(2);
    expect(deriveKeyMock).toHaveBeenNthCalledWith(1, 'Password123!', 'real-salt', 1);
    expect(deriveKeyMock).toHaveBeenNthCalledWith(2, 'Password123!', 'duress-salt', 2);
  });

  it('should derive a dummy duress key when duress is disabled', async () => {
    await attemptDualUnlock(
      'Password123!',
      'real-salt',
      'real-verifier',
      1,
      null
    );

    expect(deriveKeyMock).toHaveBeenCalledTimes(2);
    expect(deriveKeyMock).toHaveBeenNthCalledWith(1, 'Password123!', 'real-salt', 1);
    expect(deriveKeyMock).toHaveBeenNthCalledWith(
      2,
      'Password123!',
      'Y29uc3RhbnRfdGltaW5nX2R1bW15X3NhbHQ=',
      1
    );
  });

  it('should verify both keys when duress is enabled', async () => {
    const duressConfig: DuressConfig = {
      enabled: true,
      salt: 'duress-salt',
      verifier: 'duress-verifier',
      kdfVersion: 2,
    };

    await attemptDualUnlock(
      'Password123!',
      'real-salt',
      'real-verifier',
      1,
      duressConfig
    );

    expect(verifyKeyMock).toHaveBeenCalledTimes(2);
    expect(verifyKeyMock).toHaveBeenNthCalledWith(1, 'real-verifier', expect.any(Object));
    expect(verifyKeyMock).toHaveBeenNthCalledWith(2, 'duress-verifier', expect.any(Object));
  });
});
