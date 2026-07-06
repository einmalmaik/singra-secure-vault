// Copyright (c) 2025-2026 Maunting Studios
// Licensed under the Business Source License 1.1 - see LICENSE
/**
 * @fileoverview Account session retention policy.
 *
 * Only non-secret policy metadata is stored here. Auth tokens remain in the
 * BFF HttpOnly cookie for Web/PWA and in the Tauri keychain for desktop.
 */

export const AUTH_SESSION_RETENTION_STORAGE_KEY = "singra-auth-session-retention";
export const AUTH_SESSION_LAST_ACTIVE_STORAGE_KEY = "singra-auth-session-last-active";
export const AUTH_SESSION_RETENTION_CHANGED_EVENT = "singra:auth-session-retention-changed";

export const AUTH_SESSION_RETENTION_KEEP_SIGNED_IN = 0;

const DEFAULT_RETENTION_MS = AUTH_SESSION_RETENTION_KEEP_SIGNED_IN;
const MIN_RETENTION_MS = 60 * 1000;
const MAX_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export interface AuthSessionRetentionPolicy {
  timeoutMs: number;
}

export function readAuthSessionRetentionPolicy(
  storage: Storage | null = getLocalStorage(),
): AuthSessionRetentionPolicy {
  if (!storage) {
    return { timeoutMs: DEFAULT_RETENTION_MS };
  }

  const raw = storage.getItem(AUTH_SESSION_RETENTION_STORAGE_KEY);
  const parsed = raw ? Number.parseInt(raw, 10) : DEFAULT_RETENTION_MS;
  const timeoutMs = normalizeRetentionTimeoutMs(parsed);

  if (String(timeoutMs) !== raw && raw !== null) {
    storage.setItem(AUTH_SESSION_RETENTION_STORAGE_KEY, String(timeoutMs));
  }

  return { timeoutMs };
}

export function saveAuthSessionRetentionPolicy(
  timeoutMs: number,
  storage: Storage | null = getLocalStorage(),
): AuthSessionRetentionPolicy {
  const normalized = normalizeRetentionTimeoutMs(timeoutMs);
  storage?.setItem(AUTH_SESSION_RETENTION_STORAGE_KEY, String(normalized));
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(AUTH_SESSION_RETENTION_CHANGED_EVENT));
  }
  return { timeoutMs: normalized };
}

export function recordAuthSessionActivity(
  nowMs = Date.now(),
  storage: Storage | null = getLocalStorage(),
): void {
  storage?.setItem(AUTH_SESSION_LAST_ACTIVE_STORAGE_KEY, String(nowMs));
}

export function clearAuthSessionActivity(
  storage: Storage | null = getLocalStorage(),
): void {
  storage?.removeItem(AUTH_SESSION_LAST_ACTIVE_STORAGE_KEY);
}

export function isAuthSessionExpiredByRetentionPolicy(
  nowMs = Date.now(),
  storage: Storage | null = getLocalStorage(),
): boolean {
  const { timeoutMs } = readAuthSessionRetentionPolicy(storage);
  if (timeoutMs === AUTH_SESSION_RETENTION_KEEP_SIGNED_IN) {
    return false;
  }

  const lastActiveMs = readLastActiveMs(storage);
  if (lastActiveMs === null) {
    return false;
  }

  return nowMs - lastActiveMs >= timeoutMs;
}

export function getAuthSessionRetentionDelayMs(
  nowMs = Date.now(),
  storage: Storage | null = getLocalStorage(),
): number | null {
  const { timeoutMs } = readAuthSessionRetentionPolicy(storage);
  if (timeoutMs === AUTH_SESSION_RETENTION_KEEP_SIGNED_IN) {
    return null;
  }

  const lastActiveMs = readLastActiveMs(storage);
  if (lastActiveMs === null) {
    return timeoutMs;
  }

  return Math.max(0, timeoutMs - (nowMs - lastActiveMs));
}

function normalizeRetentionTimeoutMs(timeoutMs: number): number {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
    return DEFAULT_RETENTION_MS;
  }

  if (timeoutMs === AUTH_SESSION_RETENTION_KEEP_SIGNED_IN) {
    return AUTH_SESSION_RETENTION_KEEP_SIGNED_IN;
  }

  if (timeoutMs < MIN_RETENTION_MS) {
    return DEFAULT_RETENTION_MS;
  }

  return Math.min(timeoutMs, MAX_RETENTION_MS);
}

function readLastActiveMs(storage: Storage | null): number | null {
  if (!storage) {
    return null;
  }

  const raw = storage.getItem(AUTH_SESSION_LAST_ACTIVE_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    storage.removeItem(AUTH_SESSION_LAST_ACTIVE_STORAGE_KEY);
    return null;
  }

  return parsed;
}

function getLocalStorage(): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage;
}
