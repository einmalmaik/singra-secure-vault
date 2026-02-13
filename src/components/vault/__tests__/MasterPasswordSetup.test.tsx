// Copyright (c) 2025-2026 Maunting Studios
// Licensed under the Business Source License 1.1 — see LICENSE
/**
 * @fileoverview Tests for MasterPasswordSetup Component
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MasterPasswordSetup } from "../MasterPasswordSetup";

// ============ Mocks ============

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

const mockToast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

const mockSetupMasterPassword = vi.fn().mockResolvedValue({ error: null });
vi.mock("@/contexts/VaultContext", () => ({
  useVault: () => ({
    setupMasterPassword: (...args: unknown[]) => mockSetupMasterPassword(...args),
  }),
}));

vi.mock("@/services/passwordGenerator", () => ({
  calculateStrength: (password: string) => {
    if (password.length < 12) return { score: 1, entropy: 30, label: "weak", color: "bg-red-500" };
    if (password.length < 16) return { score: 2, entropy: 50, label: "fair", color: "bg-yellow-500" };
    return { score: 4, entropy: 80, label: "strong", color: "bg-green-500" };
  },
  generatePassword: () => "Xy9!kL#mP2qR@wZv8nBj",
}));

// ============ Tests ============

describe("MasterPasswordSetup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSetupMasterPassword.mockResolvedValue({ error: null });
  });

  it("should render password input, confirm input, and submit button", () => {
    render(<MasterPasswordSetup />);

    expect(screen.getByLabelText("auth.masterPassword.password")).toBeInTheDocument();
    expect(screen.getByLabelText("auth.masterPassword.confirmPassword")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /auth\.masterPassword\.submit/i })).toBeInTheDocument();
  });

  it("should disable submit when password is empty", () => {
    render(<MasterPasswordSetup />);

    const submitBtn = screen.getByRole("button", { name: /auth\.masterPassword\.submit/i });
    expect(submitBtn).toBeDisabled();
  });

  it("should disable submit when passwords do not match", () => {
    render(<MasterPasswordSetup />);

    fireEvent.change(screen.getByLabelText("auth.masterPassword.password"), {
      target: { value: "Abcdef123456!" },
    });
    fireEvent.change(screen.getByLabelText("auth.masterPassword.confirmPassword"), {
      target: { value: "DifferentPassword" },
    });

    const submitBtn = screen.getByRole("button", { name: /auth\.masterPassword\.submit/i });
    expect(submitBtn).toBeDisabled();
  });

  it("should show mismatch error when confirm password differs", () => {
    render(<MasterPasswordSetup />);

    fireEvent.change(screen.getByLabelText("auth.masterPassword.password"), {
      target: { value: "TestPassword1!" },
    });
    fireEvent.change(screen.getByLabelText("auth.masterPassword.confirmPassword"), {
      target: { value: "Different" },
    });

    expect(screen.getByText("auth.errors.passwordMismatch")).toBeInTheDocument();
  });

  it("should reject weak passwords with toast", async () => {
    render(<MasterPasswordSetup />);

    // Short password (< 12 chars)
    fireEvent.change(screen.getByLabelText("auth.masterPassword.password"), {
      target: { value: "short" },
    });
    fireEvent.change(screen.getByLabelText("auth.masterPassword.confirmPassword"), {
      target: { value: "short" },
    });

    const form = screen.getByLabelText("auth.masterPassword.password").closest("form")!;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "destructive" })
      );
    });
    expect(mockSetupMasterPassword).not.toHaveBeenCalled();
  });

  it("should fill both fields when generate strong password button is clicked", () => {
    render(<MasterPasswordSetup />);

    const genBtn = screen.getByText("Starkes Passwort generieren");
    fireEvent.click(genBtn);

    const passwordInput = screen.getByLabelText("auth.masterPassword.password") as HTMLInputElement;
    const confirmInput = screen.getByLabelText("auth.masterPassword.confirmPassword") as HTMLInputElement;

    expect(passwordInput.value).toBe("Xy9!kL#mP2qR@wZv8nBj");
    expect(confirmInput.value).toBe("Xy9!kL#mP2qR@wZv8nBj");
  });

  it("should call setupMasterPassword on valid submit", async () => {
    render(<MasterPasswordSetup />);

    // Use the generate button for a guaranteed strong password
    fireEvent.click(screen.getByText("Starkes Passwort generieren"));

    const form = screen.getByLabelText("auth.masterPassword.password").closest("form")!;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(mockSetupMasterPassword).toHaveBeenCalledWith("Xy9!kL#mP2qR@wZv8nBj");
    });
  });

  it("should display strength meter when password is entered", () => {
    render(<MasterPasswordSetup />);

    fireEvent.change(screen.getByLabelText("auth.masterPassword.password"), {
      target: { value: "Xy9!kL#mP2qR@wZv8nBj" },
    });

    // Strength label shows with bits
    expect(screen.getByText(/80 bits/)).toBeInTheDocument();
  });
});
