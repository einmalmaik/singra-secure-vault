// Copyright (c) 2025-2026 Maunting Studios
// Licensed under the Business Source License 1.1 — see LICENSE
/**
 * @fileoverview Tests for PasswordGenerator Component
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PasswordGenerator } from "../PasswordGenerator";

// ResizeObserver polyfill for shadcn Slider
global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

// ============ Mocks ============

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        "generator.placeholder": "Click generate",
        "generator.generate": "Generate",
        "generator.use": "Use",
        "generator.strength.label": "Strength",
        "generator.strength.strong": "Strong",
        "generator.mode.password": "Password",
        "generator.mode.passphrase": "Passphrase",
        "generator.length": "Length",
        "generator.wordCount": "Words",
        "generator.capitalize": "Capitalize",
        "generator.includeNumber": "Include Number",
      };
      return map[key] || key;
    },
  }),
}));

const mockToast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

const mockWriteClipboard = vi.fn().mockResolvedValue(undefined);
vi.mock("@/services/clipboardService", () => ({
  writeClipboard: (...args: unknown[]) => mockWriteClipboard(...args),
}));

let callCount = 0;
vi.mock("@/services/passwordGenerator", () => ({
  generatePassword: () => {
    callCount++;
    return callCount === 1 ? "Abcd1234!@#$efgh" : "NewPass5678!@#xyz";
  },
  generatePassphrase: () => "correct-horse-battery-staple",
  calculateStrength: () => ({
    score: 4,
    entropy: 85,
    label: "strong",
    color: "bg-green-500",
  }),
  DEFAULT_PASSWORD_OPTIONS: { length: 16, uppercase: true, lowercase: true, numbers: true, symbols: true },
  DEFAULT_PASSPHRASE_OPTIONS: { wordCount: 4, separator: "-", capitalize: true, includeNumber: true },
}));

// ============ Tests ============

describe("PasswordGenerator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    callCount = 0;
  });

  it("should show placeholder text before generating", () => {
    render(<PasswordGenerator />);
    expect(screen.getByText("Click generate")).toBeInTheDocument();
  });

  it("should generate a password when Generate button is clicked", () => {
    render(<PasswordGenerator />);

    fireEvent.click(screen.getByText("Generate"));

    expect(screen.getByText("Abcd1234!@#$efgh")).toBeInTheDocument();
  });

  it("should generate a new password on subsequent clicks", () => {
    render(<PasswordGenerator />);

    fireEvent.click(screen.getByText("Generate"));
    expect(screen.getByText("Abcd1234!@#$efgh")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Generate"));
    expect(screen.getByText("NewPass5678!@#xyz")).toBeInTheDocument();
  });

  it("should call writeClipboard when copy button is clicked", () => {
    render(<PasswordGenerator />);

    // Generate first
    fireEvent.click(screen.getByText("Generate"));

    // Find copy button (the one with Copy icon, not Generate)
    const buttons = screen.getAllByRole("button");
    const copyBtn = buttons.find(
      (b) => !b.textContent?.includes("Generate") && !b.textContent?.includes("Use")
    );
    if (copyBtn) fireEvent.click(copyBtn);

    expect(mockWriteClipboard).toHaveBeenCalledWith("Abcd1234!@#$efgh");
  });

  it("should call onSelect when Use button is clicked", () => {
    const onSelect = vi.fn();
    render(<PasswordGenerator onSelect={onSelect} />);

    fireEvent.click(screen.getByText("Generate"));
    fireEvent.click(screen.getByText("Use"));

    expect(onSelect).toHaveBeenCalledWith("Abcd1234!@#$efgh");
  });

  it("should not show Use button without onSelect prop", () => {
    render(<PasswordGenerator />);
    expect(screen.queryByText("Use")).not.toBeInTheDocument();
  });

  it("should show Password and Passphrase tabs", () => {
    render(<PasswordGenerator />);

    expect(screen.getByText("Password")).toBeInTheDocument();
    expect(screen.getByText("Passphrase")).toBeInTheDocument();
  });
});
