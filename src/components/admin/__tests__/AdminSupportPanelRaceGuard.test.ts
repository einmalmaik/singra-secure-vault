// Copyright (c) 2025-2026 Maunting Studios
// Licensed under the Business Source License 1.1 — see LICENSE
import { describe, expect, it } from "vitest";
import { shouldRefreshTicketDetailAfterMutation } from "@/components/admin/AdminSupportPanel";

describe("shouldRefreshTicketDetailAfterMutation", () => {
  it("returns false when selected ticket changed during async mutation", () => {
    expect(shouldRefreshTicketDetailAfterMutation("ticket-a", "ticket-b")).toBe(false);
  });
});
