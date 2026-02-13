// Copyright (c) 2025-2026 Maunting Studios
// Licensed under the Business Source License 1.1 — see LICENSE
/**
 * @fileoverview Tests for CookieConsent Component
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { CookieConsent } from "../CookieConsent";

// ============ Mocks ============

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        "cookies.banner.title": "Cookie Settings",
        "cookies.banner.description": "We use cookies for essential functionality.",
        "cookies.banner.manage": "Manage",
        "cookies.banner.acceptAll": "Accept All",
        "cookies.settings.title": "Cookie Preferences",
        "cookies.settings.description": "Manage your cookie preferences.",
        "cookies.settings.save": "Save",
        "cookies.categories.necessary.title": "Necessary",
        "cookies.categories.necessary.description": "Required for the app to work.",
        "cookies.categories.optional.title": "Optional",
        "cookies.categories.optional.description": "Analytics and preferences.",
        "common.cancel": "Cancel",
      };
      return map[key] || key;
    },
  }),
}));

vi.mock("@/lib/utils", () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(" "),
}));

// ============ Tests ============

describe("CookieConsent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should show banner after 1s delay when no consent exists", async () => {
    render(<CookieConsent />);

    // Banner not visible initially
    expect(screen.queryByText("Cookie Settings")).not.toBeInTheDocument();

    // Advance past the 1s delay
    act(() => {
      vi.advanceTimersByTime(1100);
    });

    expect(screen.getByText("Cookie Settings")).toBeInTheDocument();
  });

  it("should not show banner when consent already exists", () => {
    localStorage.setItem(
      "singra-cookie-consent",
      JSON.stringify({ necessary: true, optional: false })
    );

    render(<CookieConsent />);

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(screen.queryByText("Cookie Settings")).not.toBeInTheDocument();
  });

  it("should save consent and hide banner when Accept All is clicked", () => {
    render(<CookieConsent />);

    act(() => {
      vi.advanceTimersByTime(1100);
    });

    fireEvent.click(screen.getByText("Accept All"));

    const consent = JSON.parse(localStorage.getItem("singra-cookie-consent")!);
    expect(consent.optional).toBe(true);
    expect(consent.necessary).toBe(true);
    expect(screen.queryByText("Accept All")).not.toBeInTheDocument();
  });

  it("should open settings dialog when Manage is clicked", () => {
    render(<CookieConsent />);

    act(() => {
      vi.advanceTimersByTime(1100);
    });

    fireEvent.click(screen.getByText("Manage"));

    expect(screen.getByText("Cookie Preferences")).toBeInTheDocument();
  });

  it("should have necessary switch always on and disabled", () => {
    render(<CookieConsent />);

    act(() => {
      vi.advanceTimersByTime(1100);
    });

    fireEvent.click(screen.getByText("Manage"));

    const necessarySwitch = screen.getByRole("switch", { name: /necessary/i });
    expect(necessarySwitch).toBeChecked();
    expect(necessarySwitch).toBeDisabled();
  });

  it("should open dialog via custom event singra:open-cookie-settings", () => {
    localStorage.setItem(
      "singra-cookie-consent",
      JSON.stringify({ necessary: true, optional: false })
    );

    render(<CookieConsent />);

    // Dispatch custom event
    act(() => {
      window.dispatchEvent(new Event("singra:open-cookie-settings"));
    });

    expect(screen.getByText("Cookie Preferences")).toBeInTheDocument();
  });
});
