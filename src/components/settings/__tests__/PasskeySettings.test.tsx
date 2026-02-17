// Copyright (c) 2025-2026 Maunting Studios
// Licensed under the Business Source License 1.1 â€” see LICENSE
/**
 * @fileoverview Tests for PasskeySettings Component
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PasskeySettings } from "../PasskeySettings";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback || key,
  }),
}));

const mockToast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

const mockGetRawKeyForPasskey = vi.fn();
vi.mock("@/contexts/VaultContext", () => ({
  useVault: () => ({
    webAuthnAvailable: true,
    getRawKeyForPasskey: (...args: unknown[]) => mockGetRawKeyForPasskey(...args),
  }),
}));

const mockRegisterPasskey = vi.fn();
const mockActivatePasskeyPrf = vi.fn();
const mockListPasskeys = vi.fn();
const mockDeletePasskey = vi.fn();

vi.mock("@/services/passkeyService", () => ({
  registerPasskey: (...args: unknown[]) => mockRegisterPasskey(...args),
  activatePasskeyPrf: (...args: unknown[]) => mockActivatePasskeyPrf(...args),
  listPasskeys: (...args: unknown[]) => mockListPasskeys(...args),
  deletePasskey: (...args: unknown[]) => mockDeletePasskey(...args),
  isWebAuthnAvailable: vi.fn().mockReturnValue(true),
  isPlatformAuthenticatorAvailable: vi.fn().mockResolvedValue(true),
}));

describe("PasskeySettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListPasskeys.mockResolvedValue([]);
    mockDeletePasskey.mockResolvedValue({ success: true });
    mockGetRawKeyForPasskey.mockResolvedValue(new Uint8Array(32));
  });

  it("activates PRF when registration requires a second ceremony", async () => {
    mockRegisterPasskey.mockResolvedValue({
      success: true,
      credentialId: "cred-1",
      prfEnabled: true,
      needsPrfActivation: true,
    });
    mockActivatePasskeyPrf.mockResolvedValue({ success: true, credentialId: "cred-1" });

    render(<PasskeySettings />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Add Passkey" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Add Passkey" }));

    fireEvent.change(screen.getByLabelText("Confirm master password"), {
      target: { value: "MasterPassword123!" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Register Passkey" }));

    await waitFor(() => {
      expect(mockRegisterPasskey).toHaveBeenCalledTimes(1);
      expect(mockActivatePasskeyPrf).toHaveBeenCalledTimes(1);
      expect(mockActivatePasskeyPrf.mock.calls[0][1]).toBe("cred-1");
    });
  });
});
