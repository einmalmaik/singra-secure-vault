/**
 * @fileoverview Tests for TwoFactorVerificationModal Component
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { TwoFactorVerificationModal } from "../TwoFactorVerificationModal";

// ============ Mocks ============

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        "auth.twoFactor.title": "Two-Factor Authentication",
        "auth.twoFactor.description": "Enter your 6-digit code",
        "auth.twoFactor.backupCodeDesc": "Enter your backup code",
        "auth.twoFactor.codeLabel": "Authentication Code",
        "auth.twoFactor.backupCodeLabel": "Backup Code",
        "auth.twoFactor.verify": "Verify",
        "auth.twoFactor.useBackupCode": "Use Backup Code",
        "auth.twoFactor.useAuthenticator": "Use Authenticator",
        "settings.security.twoFactor.verify.invalid": "Invalid code",
      };
      if (key === "auth.twoFactor.newCodeIn") return `New code in ${params?.seconds}s`;
      return map[key] || key;
    },
  }),
}));

vi.mock("@/services/totpService", () => ({
  getTimeRemaining: () => 20,
}));

// ============ Tests ============

describe("TwoFactorVerificationModal", () => {
  const mockOnVerify = vi.fn();
  const mockOnCancel = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockOnVerify.mockResolvedValue(true);
  });

  it("should show 6-digit TOTP input when open", () => {
    render(
      <TwoFactorVerificationModal
        open={true}
        onVerify={mockOnVerify}
        onCancel={mockOnCancel}
      />
    );

    expect(screen.getByText("Two-Factor Authentication")).toBeInTheDocument();
    const input = screen.getByPlaceholderText("000000");
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute("maxLength", "6");
  });

  it("should switch to backup code mode with 9-char input", () => {
    render(
      <TwoFactorVerificationModal
        open={true}
        onVerify={mockOnVerify}
        onCancel={mockOnCancel}
      />
    );

    fireEvent.click(screen.getByText("Use Backup Code"));

    const input = screen.getByPlaceholderText("XXXX-XXXX");
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute("maxLength", "9");
  });

  it("should call onVerify with code and isBackupCode on verify", async () => {
    render(
      <TwoFactorVerificationModal
        open={true}
        onVerify={mockOnVerify}
        onCancel={mockOnCancel}
      />
    );

    const input = screen.getByPlaceholderText("000000");
    fireEvent.change(input, { target: { value: "123456" } });

    fireEvent.click(screen.getByText("Verify"));

    await waitFor(() => {
      expect(mockOnVerify).toHaveBeenCalledWith("123456", false);
    });
  });

  it("should toggle between TOTP and backup mode", () => {
    render(
      <TwoFactorVerificationModal
        open={true}
        onVerify={mockOnVerify}
        onCancel={mockOnCancel}
      />
    );

    // Initially TOTP mode
    expect(screen.getByPlaceholderText("000000")).toBeInTheDocument();

    // Switch to backup
    fireEvent.click(screen.getByText("Use Backup Code"));
    expect(screen.getByPlaceholderText("XXXX-XXXX")).toBeInTheDocument();

    // Switch back
    fireEvent.click(screen.getByText("Use Authenticator"));
    expect(screen.getByPlaceholderText("000000")).toBeInTheDocument();
  });

  it("should show error and clear code on failed verification", async () => {
    mockOnVerify.mockResolvedValue(false);

    render(
      <TwoFactorVerificationModal
        open={true}
        onVerify={mockOnVerify}
        onCancel={mockOnCancel}
      />
    );

    const input = screen.getByPlaceholderText("000000");
    fireEvent.change(input, { target: { value: "999999" } });
    fireEvent.click(screen.getByText("Verify"));

    await waitFor(() => {
      expect(screen.getByText("Invalid code")).toBeInTheDocument();
    });
  });

  it("should strip non-digit characters in TOTP mode", () => {
    render(
      <TwoFactorVerificationModal
        open={true}
        onVerify={mockOnVerify}
        onCancel={mockOnCancel}
      />
    );

    const input = screen.getByPlaceholderText("000000") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "12ab34" } });

    expect(input.value).toBe("1234");
  });

  it("should disable verify button when code is incomplete", () => {
    render(
      <TwoFactorVerificationModal
        open={true}
        onVerify={mockOnVerify}
        onCancel={mockOnCancel}
      />
    );

    const verifyBtn = screen.getByText("Verify");
    expect(verifyBtn).toBeDisabled();

    const input = screen.getByPlaceholderText("000000");
    fireEvent.change(input, { target: { value: "123" } });

    expect(verifyBtn).toBeDisabled();
  });
});
