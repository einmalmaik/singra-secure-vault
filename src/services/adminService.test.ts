// Copyright (c) 2025-2026 Maunting Studios
// Licensed under the Business Source License 1.1 — see LICENSE
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetSession, mockInvoke, supabaseMock } = vi.hoisted(() => {
  const mockInvoke = vi.fn();
  const mockGetSession = vi.fn();

  const supabaseMock = {
    auth: {
      getSession: mockGetSession,
    },
    functions: {
      invoke: mockInvoke,
    },
  };

  return {
    mockGetSession,
    mockInvoke,
    supabaseMock,
  };
});

vi.mock("@/integrations/supabase/client", () => ({
  supabase: supabaseMock,
}));

import {
  assignUserSubscription,
  getAdminSupportTicket,
  getTeamAccess,
  listAdminSupportTickets,
  listRolePermissions,
  listTeamMembers,
  lookupAdminUser,
  setRolePermission,
  setTeamMemberRole,
} from "@/services/adminService";

describe("adminService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue({
      data: {
        session: {
          access_token: "test-token",
        },
      },
      error: null,
    });
  });

  it("loads team access from admin-team function", async () => {
    mockInvoke.mockResolvedValue({
      data: {
        success: true,
        access: {
          roles: ["admin"],
          permissions: ["support.admin.access"],
          is_admin: true,
          can_access_admin: true,
        },
      },
      error: null,
    });

    const result = await getTeamAccess();

    expect(mockInvoke).toHaveBeenCalledWith("admin-team", {
      body: {
        action: "get_access",
      },
      headers: {
        Authorization: "Bearer test-token",
      },
    });
    expect(result.error).toBeNull();
    expect(result.access?.can_access_admin).toBe(true);
  });

  it("lists support tickets with filter payload", async () => {
    mockInvoke.mockResolvedValue({
      data: {
        success: true,
        tickets: [{ id: "ticket-1", subject: "Issue" }],
      },
      error: null,
    });

    const result = await listAdminSupportTickets({
      status: "open",
      search: "Issue",
      limit: 10,
    });

    expect(mockInvoke).toHaveBeenCalledWith("admin-support", {
      body: {
        action: "list_tickets",
        status: "open",
        search: "Issue",
        limit: 10,
      },
      headers: {
        Authorization: "Bearer test-token",
      },
    });
    expect(result.error).toBeNull();
    expect(result.tickets).toHaveLength(1);
  });

  it("returns normalized error when role update fails", async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: { message: "role update failed" },
    });

    const result = await setTeamMemberRole("user-1", "moderator");

    expect(result.success).toBe(false);
    expect(result.error?.message).toBe("role update failed");
  });

  it("updates role permission via admin-team function", async () => {
    mockInvoke.mockResolvedValue({
      data: {
        success: true,
      },
      error: null,
    });

    const result = await setRolePermission("moderator", "support.tickets.status", true);

    expect(mockInvoke).toHaveBeenCalledWith("admin-team", {
      body: {
        action: "set_role_permission",
        role: "moderator",
        permission_key: "support.tickets.status",
        enabled: true,
      },
      headers: {
        Authorization: "Bearer test-token",
      },
    });
    expect(result.success).toBe(true);
    expect(result.error).toBeNull();
  });

  it("handles ticket detail payload", async () => {
    mockInvoke.mockResolvedValue({
      data: {
        success: true,
        ticket: { id: "ticket-1", subject: "Issue" },
        messages: [{ id: "msg-1", body: "Hi" }],
        permissions: {
          can_reply: true,
          can_read_internal: true,
          can_update_status: true,
        },
      },
      error: null,
    });

    const result = await getAdminSupportTicket("ticket-1");

    expect(mockInvoke).toHaveBeenCalledWith("admin-support", {
      body: {
        action: "get_ticket",
        ticket_id: "ticket-1",
      },
      headers: {
        Authorization: "Bearer test-token",
      },
    });
    expect(result.error).toBeNull();
    expect(result.detail?.messages).toHaveLength(1);
  });

  it("loads team lists from their edge functions", async () => {
    mockInvoke
      .mockResolvedValueOnce({
        data: {
          success: true,
          members: [{ user_id: "u1", primary_role: "admin" }],
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          success: true,
          permissions: [{ permission_key: "support.tickets.read" }],
        },
        error: null,
      });

    const membersResult = await listTeamMembers();
    const permissionsResult = await listRolePermissions();

    expect(membersResult.members).toHaveLength(1);
    expect(permissionsResult.permissions).toHaveLength(1);
  });

  it("looks up a user for subscription assignment", async () => {
    mockInvoke.mockResolvedValue({
      data: {
        success: true,
        user: {
          user_id: "user-1",
          email: "a***@mail.com",
          tier: "free",
          status: "active",
        },
      },
      error: null,
    });

    const result = await lookupAdminUser({ email: "user@mail.com" });

    expect(mockInvoke).toHaveBeenCalledWith("admin-support", {
      body: {
        action: "lookup_user",
        user_id: undefined,
        email: "user@mail.com",
      },
      headers: {
        Authorization: "Bearer test-token",
      },
    });
    expect(result.error).toBeNull();
    expect(result.user?.user_id).toBe("user-1");
  });

  it("assigns a user subscription", async () => {
    mockInvoke.mockResolvedValue({
      data: {
        success: true,
        subscription: {
          user_id: "user-1",
          tier: "premium",
          status: "active",
          updated_at: "2026-02-19T00:00:00.000Z",
        },
      },
      error: null,
    });

    const result = await assignUserSubscription({
      userId: "user-1",
      tier: "premium",
      reason: "Manual upgrade",
      ticketId: "ticket-1",
    });

    expect(mockInvoke).toHaveBeenCalledWith("admin-support", {
      body: {
        action: "assign_subscription",
        ticket_id: "ticket-1",
        user_id: "user-1",
        tier: "premium",
        reason: "Manual upgrade",
      },
      headers: {
        Authorization: "Bearer test-token",
      },
    });
    expect(result.error).toBeNull();
    expect(result.subscription?.tier).toBe("premium");
  });

  it("returns auth error when session is missing for assign subscription", async () => {
    mockGetSession.mockResolvedValue({
      data: {
        session: null,
      },
      error: null,
    });

    const result = await assignUserSubscription({
      userId: "user-1",
      tier: "premium",
      reason: "Manual upgrade",
    });

    expect(result.subscription).toBeNull();
    expect(result.error?.message).toBe("Authentication required");
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("returns normalized error for lookup invocation failures", async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: { message: "lookup failed" },
    });

    const result = await lookupAdminUser({ userId: "user-1" });

    expect(result.user).toBeNull();
    expect(result.error?.message).toBe("lookup failed");
  });

  it("returns auth error when session is missing for lookup", async () => {
    mockGetSession.mockResolvedValue({
      data: {
        session: null,
      },
      error: null,
    });

    const result = await lookupAdminUser({ email: "user@mail.com" });

    expect(result.user).toBeNull();
    expect(result.error?.message).toBe("Authentication required");
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("returns normalized error for assign invocation failures", async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: { message: "assign failed" },
    });

    const result = await assignUserSubscription({
      userId: "user-1",
      tier: "families",
      reason: "Manual support action",
    });

    expect(result.subscription).toBeNull();
    expect(result.error?.message).toBe("assign failed");
  });
});
