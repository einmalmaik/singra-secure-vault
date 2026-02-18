// Copyright (c) 2025-2026 Maunting Studios
// Licensed under the Business Source License 1.1 — see LICENSE
/**
 * @fileoverview Tests for ThemeProvider
 * 
 * Tests dark-mode-only ThemeProvider behavior.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { ThemeProvider, useTheme } from "./ThemeProvider";
import { ReactNode } from "react";

// ============ Test Setup ============

beforeEach(() => {
    localStorage.clear();

    document.documentElement.classList.remove("light", "dark");
});

afterEach(() => {
    vi.clearAllMocks();
});

// ============ Helper: Wrapper Component ============

function wrapper({ children }: { children: ReactNode }) {
    return <ThemeProvider>{children}</ThemeProvider>;
}

// ============ Tests ============

describe("ThemeProvider", () => {
    describe("useTheme hook", () => {
        it("throws error when used outside ThemeProvider", () => {
            const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

            expect(() => {
                renderHook(() => useTheme());
            }).toThrow("useTheme must be used within a ThemeProvider");

            consoleError.mockRestore();
        });
    });

    it("always resolves to dark", () => {
        const { result } = renderHook(() => useTheme(), { wrapper });

        expect(result.current.theme).toBe("dark");
        expect(result.current.resolvedTheme).toBe("dark");
    });

    it("ignores setTheme calls and stays dark", () => {
        const { result } = renderHook(() => useTheme(), { wrapper });

        act(() => {
            result.current.setTheme("light");
            result.current.setTheme("system");
        });

        expect(result.current.theme).toBe("dark");
        expect(result.current.resolvedTheme).toBe("dark");
    });

    it("removes stored legacy theme preference on mount", () => {
        localStorage.setItem("Singra-theme", "light");
        renderHook(() => useTheme(), { wrapper });
        expect(localStorage.getItem("Singra-theme")).toBeNull();
    });

    it("applies dark class to document root", () => {
        renderHook(() => useTheme(), { wrapper });
        expect(document.documentElement.classList.contains("dark")).toBe(true);
        expect(document.documentElement.classList.contains("light")).toBe(false);
    });
});
