// Copyright (c) 2025-2026 Maunting Studios
// Licensed under the Business Source License 1.1 - see LICENSE
/**
 * @fileoverview Unit tests for edgeFunctionService.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetSession, mockRefreshSession, mockInvoke, supabaseMock } = vi.hoisted(() => {
  const mockInvoke = vi.fn();
  const mockGetSession = vi.fn();
  const mockRefreshSession = vi.fn();

  const supabaseMock = {
    auth: {
      getSession: mockGetSession,
      refreshSession: mockRefreshSession,
    },
    functions: {
      invoke: mockInvoke,
    },
  };

  return {
    mockGetSession,
    mockRefreshSession,
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
      data: { session: { access_token: "test-token" } },
      error: null,
    });
    mockRefreshSession.mockResolvedValue({
      data: { session: null },
      error: null,
    });
  });

  it("invokes function with explicit bearer token", async () => {
    mockInvoke.mockResolvedValue({
      data: { success: true },
      error: null,
    });

    const result = await invokeAuthedFunction<{ success: boolean }>("invite-family-member", {
      email: "a@example.com",
    });

    expect(mockInvoke).toHaveBeenCalledWith("invite-family-member", {
      body: { email: "a@example.com" },
      headers: { Authorization: "Bearer test-token" },
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
      data: { session: { access_token: "fresh-token" } },
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
      headers: { Authorization: "Bearer fresh-token" },
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
