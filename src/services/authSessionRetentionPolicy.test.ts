import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUTH_SESSION_LAST_ACTIVE_STORAGE_KEY,
  AUTH_SESSION_RETENTION_CHANGED_EVENT,
  AUTH_SESSION_RETENTION_KEEP_SIGNED_IN,
  AUTH_SESSION_RETENTION_STORAGE_KEY,
  clearAuthSessionActivity,
  getAuthSessionRetentionDelayMs,
  isAuthSessionExpiredByRetentionPolicy,
  readAuthSessionRetentionPolicy,
  recordAuthSessionActivity,
  saveAuthSessionRetentionPolicy,
} from "@/services/authSessionRetentionPolicy";

describe("authSessionRetentionPolicy", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useRealTimers();
  });

  it("defaults to keeping the account session signed in without storing tokens", () => {
    expect(readAuthSessionRetentionPolicy()).toEqual({
      timeoutMs: AUTH_SESSION_RETENTION_KEEP_SIGNED_IN,
    });
    expect(getAuthSessionRetentionDelayMs()).toBeNull();
    expect(localStorage.getItem(AUTH_SESSION_RETENTION_STORAGE_KEY)).toBeNull();
  });

  it("stores only retention policy and activity timestamp", () => {
    const eventListener = vi.fn();
    window.addEventListener(AUTH_SESSION_RETENTION_CHANGED_EVENT, eventListener);

    saveAuthSessionRetentionPolicy(15 * 60 * 1000);
    recordAuthSessionActivity(Date.parse("2026-07-06T10:00:00.000Z"));

    expect(localStorage.getItem(AUTH_SESSION_RETENTION_STORAGE_KEY)).toBe(String(15 * 60 * 1000));
    expect(localStorage.getItem(AUTH_SESSION_LAST_ACTIVE_STORAGE_KEY)).toBe(String(Date.parse("2026-07-06T10:00:00.000Z")));
    expect(JSON.stringify({ ...localStorage })).not.toContain("access_token");
    expect(JSON.stringify({ ...localStorage })).not.toContain("refresh_token");
    expect(eventListener).toHaveBeenCalledTimes(1);

    window.removeEventListener(AUTH_SESSION_RETENTION_CHANGED_EVENT, eventListener);
  });

  it("expires when the last account activity is older than the configured retention", () => {
    saveAuthSessionRetentionPolicy(15 * 60 * 1000);
    recordAuthSessionActivity(Date.parse("2026-07-06T10:00:00.000Z"));

    expect(isAuthSessionExpiredByRetentionPolicy(Date.parse("2026-07-06T10:14:59.000Z"))).toBe(false);
    expect(getAuthSessionRetentionDelayMs(Date.parse("2026-07-06T10:14:00.000Z"))).toBe(60 * 1000);
    expect(isAuthSessionExpiredByRetentionPolicy(Date.parse("2026-07-06T10:15:00.000Z"))).toBe(true);
  });

  it("clears activity without clearing the retention choice", () => {
    saveAuthSessionRetentionPolicy(30 * 60 * 1000);
    recordAuthSessionActivity(Date.parse("2026-07-06T10:00:00.000Z"));

    clearAuthSessionActivity();

    expect(localStorage.getItem(AUTH_SESSION_RETENTION_STORAGE_KEY)).toBe(String(30 * 60 * 1000));
    expect(localStorage.getItem(AUTH_SESSION_LAST_ACTIVE_STORAGE_KEY)).toBeNull();
  });
});
