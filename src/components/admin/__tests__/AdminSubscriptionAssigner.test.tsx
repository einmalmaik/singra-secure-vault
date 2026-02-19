// Copyright (c) 2025-2026 Maunting Studios
// Licensed under the Business Source License 1.1 — see LICENSE
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminSubscriptionAssigner } from "@/components/admin/AdminSubscriptionAssigner";

const { assignUserSubscriptionMock, lookupAdminUserMock, toastMock } = vi.hoisted(() => ({
  assignUserSubscriptionMock: vi.fn(),
  lookupAdminUserMock: vi.fn(),
  toastMock: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({
    toast: toastMock,
  }),
}));

vi.mock("@/services/adminService", () => ({
  assignUserSubscription: assignUserSubscriptionMock,
  lookupAdminUser: lookupAdminUserMock,
}));

describe("AdminSubscriptionAssigner", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    lookupAdminUserMock.mockResolvedValue({
      user: {
        user_id: "user-max",
        email: "max@example.com",
        tier: "premium",
        status: "active",
      },
      error: null,
    });

    assignUserSubscriptionMock.mockResolvedValue({
      subscription: null,
      error: null,
    });
  });

  it("resets assignment form state when ticket changes for the same user", async () => {
    const { rerender } = render(
      <AdminSubscriptionAssigner defaultUserId="user-max" ticketId="ticket-1" />
    );

    fireEvent.click(screen.getByRole("button", { name: "admin.support.subscription.lookupAction" }));

    await waitFor(() => {
      expect(screen.getByLabelText("admin.support.subscription.reasonLabel")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText("admin.support.subscription.reasonLabel"), {
      target: { value: "temporary reason" },
    });

    rerender(<AdminSubscriptionAssigner defaultUserId="user-max" ticketId="ticket-2" />);

    expect(screen.queryByLabelText("admin.support.subscription.reasonLabel")).not.toBeInTheDocument();
    expect(screen.getByLabelText("admin.support.subscription.lookupLabel")).toHaveValue("user-max");
  });
});
