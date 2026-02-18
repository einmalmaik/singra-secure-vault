// Copyright (c) 2025-2026 Maunting Studios
// Licensed under the Business Source License 1.1 - see LICENSE
/**
 * @fileoverview Unit tests for edgeFunctionService.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

function createToken(payload: Record<string, unknown>): string {
  return [
    "header",
    Buffer.from(JSON.stringify(payload)).toString("base64url"),
    "signature",
  ].join(".");
}

function createValidSessionToken(userId = "user-1"): string {
  const now = Math.floor(Date.now() / 1000);
  return createToken({
    sub: userId,
    role: "authenticated",
    exp: now + 3600,
  });
}

const { mockGetSession, mockRefreshSession, mockGetUser, mockInvoke, supabaseMock } = vi.hoisted(() => {
  const mockInvoke = vi.fn();
  const mockGetSession = vi.fn();
  const mockRefreshSession = vi.fn();
  const mockGetUser = vi.fn();

  const supabaseMock = {
    auth: {
      getSession: mockGetSession,
      refreshSession: mockRefreshSession,
      getUser: mockGetUser,
    },
    functions: {
      invoke: mockInvoke,
    },
  };

  return {
    mockGetSession,
    mockRefreshSession,
    mockGetUser,
    mockInvoke,
    supabaseMock,
  };
});

vi.mock("@/integrations/supabase/client", () => ({
  supabase: supabaseMock,
}));

import {
  invokeAuthedFunction,
  isEdgeFunctionServiceError,
} from "@/services/edgeFunctionService";

describe("edgeFunctionService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue({
      data: {
        session: {
          access_token: createValidSessionToken("user-1"),
          user: { id: "user-1" },
        },
      },
      error: null,
    });
    mockGetUser.mockResolvedValue({
      data: { user: { id: "user-1" } },
      error: null,
    });
    mockRefreshSession.mockResolvedValue({
      data: { session: null },
      error: null,
    });
  });

  it("invokes function with explicit bearer token", async () => {
    const accessToken = createValidSessionToken("user-1");
    mockGetSession.mockResolvedValueOnce({
      data: { session: { access_token: accessToken, user: { id: "user-1" } } },
      error: null,
    });

    mockInvoke.mockResolvedValue({
      data: { success: true },
      error: null,
    });

    const result = await invokeAuthedFunction<{ success: boolean }>("invite-family-member", {
      email: "a@example.com",
    });

    expect(mockInvoke).toHaveBeenCalledWith("invite-family-member", {
      body: { email: "a@example.com" },
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    expect(result.success).toBe(true);
  });

  it("throws AUTH_REQUIRED when session token is missing", async () => {
    mockGetSession.mockResolvedValueOnce({
      data: { session: null },
      error: null,
    });
    mockRefreshSession.mockResolvedValueOnce({
      data: { session: null },
      error: null,
    });

    await expect(
      invokeAuthedFunction("invite-family-member", { email: "a@example.com" }),
    ).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
      status: 401,
      message: "Authentication required",
    });
  });

  it("refreshes the session when access token is missing", async () => {
    mockGetSession.mockResolvedValueOnce({
      data: { session: null },
      error: null,
    });
    mockRefreshSession.mockResolvedValueOnce({
      data: {
        session: {
          access_token: createValidSessionToken("user-1"),
          user: { id: "user-1" },
        },
      },
      error: null,
    });
    mockInvoke.mockResolvedValueOnce({
      data: { success: true },
      error: null,
    });

    await invokeAuthedFunction<{ success: boolean }>("invite-family-member", {
      email: "a@example.com",
    });

    expect(mockInvoke).toHaveBeenCalledWith("invite-family-member", {
      body: { email: "a@example.com" },
      headers: { Authorization: `Bearer ${createValidSessionToken("user-1")}` },
    });
  });

  it("rejects anon-like tokens even when JWT is syntactically valid", async () => {
    const anonToken = createToken({
      sub: "anon-subject",
      role: "anon",
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    mockGetSession.mockResolvedValueOnce({
      data: { session: { access_token: anonToken, user: { id: "user-1" } } },
      error: null,
    });
    mockRefreshSession.mockResolvedValueOnce({
      data: { session: null },
      error: null,
    });

    await expect(
      invokeAuthedFunction("invite-family-member", { email: "a@example.com" }),
    ).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
      status: 401,
      message: "Authentication required",
    });
  });

  it("refreshes when session token is expired", async () => {
    const now = Math.floor(Date.now() / 1000);
    const expiredToken = createToken({
      sub: "user-1",
      role: "authenticated",
      exp: now - 60,
    });
    const refreshedToken = createValidSessionToken("user-1");

    mockGetSession.mockResolvedValueOnce({
      data: { session: { access_token: expiredToken, user: { id: "user-1" } } },
      error: null,
    });
    mockRefreshSession.mockResolvedValueOnce({
      data: { session: { access_token: refreshedToken, user: { id: "user-1" } } },
      error: null,
    });
    mockInvoke.mockResolvedValueOnce({
      data: { success: true },
      error: null,
    });

    await invokeAuthedFunction<{ success: boolean }>("webauthn", {
      action: "list-credentials",
    });

    expect(mockRefreshSession).toHaveBeenCalledTimes(1);
    expect(mockInvoke).toHaveBeenCalledWith("webauthn", {
      body: { action: "list-credentials" },
      headers: { Authorization: `Bearer ${refreshedToken}` },
    });
  });

  it("normalizes 403 function responses", async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: {
        message: "Edge Function returned a non-2xx status code",
        context: new Response(JSON.stringify({ error: "Families subscription required" }), {
          status: 403,
          headers: { "content-type": "application/json" },
        }),
      },
    });

    await expect(
      invokeAuthedFunction("invite-family-member", { email: "a@example.com" }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      status: 403,
      message: "Forbidden",
    });
  });

  it("exposes backend message on 400 responses", async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: {
        message: "Edge Function returned a non-2xx status code",
        context: new Response(JSON.stringify({ error: "Invalid email" }), {
          status: 400,
          headers: { "content-type": "application/json" },
        }),
      },
    });

    try {
      await invokeAuthedFunction("invite-family-member", { email: "" });
      throw new Error("Expected invokeAuthedFunction to throw");
    } catch (error) {
      expect(isEdgeFunctionServiceError(error)).toBe(true);
      expect((error as { code: string }).code).toBe("BAD_REQUEST");
      expect((error as Error).message).toBe("Invalid email");
    }
  });
});
