// Copyright (c) 2025-2026 Maunting Studios
// Licensed under the Business Source License 1.1 — see LICENSE
/**
 * @fileoverview Client-Side Unlock Rate Limiter for Singra PW
 *
 * Implements exponential backoff after failed master-password
 * attempts to deter brute-force attacks.
 *
 * Storage: localStorage (survives tab close and page reload).
 * This is a defense-in-depth measure — it can be bypassed via
 * DevTools, but combined with Argon2id's ~300 ms cost per attempt
 * it raises the bar significantly against automated attacks.
 *
 * SECURITY: Never stores any password or key material.
 */

const STORAGE_KEY = 'singra_unlock_rl';

/** After this many failures the first delay kicks in. */
const GRACE_ATTEMPTS = 3;

/** Base delay in milliseconds (doubles with each tier). */
const BASE_DELAY_MS = 5_000; // 5 seconds

/** Maximum delay cap in milliseconds. */
const MAX_DELAY_MS = 30 * 60 * 1000; // 30 minutes

// ============ Types ============

interface RateLimitState {
    /** Total consecutive failed attempts. */
    failures: number;
    /** Unix-ms timestamp until which the user is locked out. */
    lockedUntil: number;
}

// ============ Persistence Helpers ============

function loadState(): RateLimitState {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return { failures: 0, lockedUntil: 0 };
        return JSON.parse(raw) as RateLimitState;
    } catch {
        return { failures: 0, lockedUntil: 0 };
    }
}

function saveState(state: RateLimitState): void {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
        // Storage full or disabled — fail open (allow attempts)
    }
}

// ============ Public API ============

/**
 * Check whether the user is currently locked out.
 *
 * @returns `null` if unlock is allowed, or the number of
 *          milliseconds remaining in the lockout period.
 */
export function getUnlockCooldown(): number | null {
    const { lockedUntil } = loadState();
    if (lockedUntil <= 0) return null;

    const remaining = lockedUntil - Date.now();
    return remaining > 0 ? remaining : null;
}

/**
 * Record a failed unlock attempt and compute the next lockout.
 *
 * Lockout formula (after {@link GRACE_ATTEMPTS} failures):
 * ```
 * delay = min(BASE_DELAY_MS * 2^(failures - GRACE_ATTEMPTS), MAX_DELAY_MS)
 * ```
 *
 * | Attempt | Delay       |
 * |---------|-------------|
 * | 1-3     | 0 (grace)   |
 * | 4       | 5 s         |
 * | 5       | 10 s        |
 * | 6       | 20 s        |
 * | 7       | 40 s        |
 * | 8       | 80 s        |
 * | 9       | 160 s       |
 * | 10      | 5 min 20 s  |
 * | 11+     | caps at 30 min |
 */
export function recordFailedAttempt(): void {
    const state = loadState();
    state.failures += 1;

    if (state.failures > GRACE_ATTEMPTS) {
        const exponent = state.failures - GRACE_ATTEMPTS - 1;
        const delay = Math.min(BASE_DELAY_MS * Math.pow(2, exponent), MAX_DELAY_MS);
        state.lockedUntil = Date.now() + delay;
    }

    saveState(state);
}

/**
 * Reset the rate-limiter after a successful unlock.
 */
export function resetUnlockAttempts(): void {
    try {
        localStorage.removeItem(STORAGE_KEY);
    } catch {
        // Best effort
    }
}

/**
 * Get the current number of consecutive failed attempts.
 *
 * @returns Number of failures since last success
 */
export function getFailedAttemptCount(): number {
    return loadState().failures;
}
