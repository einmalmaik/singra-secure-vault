/**
 * @fileoverview Tests for ThemeProvider
 * 
 * Phase 6: Context Provider and Hook Tests
 * Tests theme context, persistence, and system preference detection.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { ThemeProvider, useTheme } from "./ThemeProvider";
import { ReactNode } from "react";

// ============ Test Setup ============

beforeEach(() => {
    // Clear localStorage before each test
    localStorage.clear();
    
    // Reset document classes
    document.documentElement.classList.remove("light", "dark");
    
    // Mock matchMedia
    Object.defineProperty(window, "matchMedia", {
        writable: true,
        value: vi.fn().mockImplementation((query) => ({
            matches: query === "(prefers-color-scheme: dark)" ? false : false,
            media: query,
            onchange: null,
            addListener: vi.fn(),
            removeListener: vi.fn(),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            dispatchEvent: vi.fn(),
        })),
    });
});

afterEach(() => {
    vi.clearAllMocks();
});

// ============ Helper: Wrapper Component ============

function wrapper({ children }: { children: ReactNode }) {
    return <ThemeProvider>{children}</ThemeProvider>;
}

function customWrapper(defaultTheme: "light" | "dark" | "system") {
    return function CustomWrapper({ children }: { children: ReactNode }) {
        return <ThemeProvider defaultTheme={defaultTheme}>{children}</ThemeProvider>;
    };
}

// ============ Tests ============

describe("ThemeProvider", () => {
    describe("useTheme hook", () => {
        it("throws error when used outside ThemeProvider", () => {
            // Suppress console.error for this test
            const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
            
            expect(() => {
                renderHook(() => useTheme());
            }).toThrow("useTheme must be used within a ThemeProvider");
            
            consoleError.mockRestore();
        });
    });

    describe("Initial state", () => {
        it("defaults to system theme", () => {
            const { result } = renderHook(() => useTheme(), { wrapper });
            
            expect(result.current.theme).toBe("system");
        });

        it("resolves system theme to light when prefers-color-scheme is light", () => {
            Object.defineProperty(window, "matchMedia", {
                writable: true,
                value: vi.fn().mockImplementation((query) => ({
                    matches: query === "(prefers-color-scheme: dark)" ? false : false,
                    media: query,
                    onchange: null,
                    addListener: vi.fn(),
                    removeListener: vi.fn(),
                    addEventListener: vi.fn(),
                    removeEventListener: vi.fn(),
                    dispatchEvent: vi.fn(),
                })),
            });
            
            const { result } = renderHook(() => useTheme(), { wrapper });
            
            expect(result.current.resolvedTheme).toBe("light");
        });

        it("resolves system theme to dark when prefers-color-scheme is dark", () => {
            Object.defineProperty(window, "matchMedia", {
                writable: true,
                value: vi.fn().mockImplementation((query) => ({
                    matches: query === "(prefers-color-scheme: dark)" ? true : false,
                    media: query,
                    onchange: null,
                    addListener: vi.fn(),
                    removeListener: vi.fn(),
                    addEventListener: vi.fn(),
                    removeEventListener: vi.fn(),
                    dispatchEvent: vi.fn(),
                })),
            });
            
            const { result } = renderHook(() => useTheme(), { wrapper: customWrapper("system") });
            
            expect(result.current.resolvedTheme).toBe("dark");
        });
    });

    describe("setTheme", () => {
        it("changes theme to dark", () => {
            const { result } = renderHook(() => useTheme(), { wrapper });
            
            act(() => {
                result.current.setTheme("dark");
            });
            
            expect(result.current.theme).toBe("dark");
            expect(result.current.resolvedTheme).toBe("dark");
        });

        it("changes theme to light", () => {
            const { result } = renderHook(() => useTheme(), { wrapper });
            
            act(() => {
                result.current.setTheme("light");
            });
            
            expect(result.current.theme).toBe("light");
            expect(result.current.resolvedTheme).toBe("light");
        });

        it("changes theme to system", () => {
            const { result } = renderHook(() => useTheme(), { wrapper });
            
            act(() => {
                result.current.setTheme("dark");
            });
            
            act(() => {
                result.current.setTheme("system");
            });
            
            expect(result.current.theme).toBe("system");
            // resolvedTheme depends on matchMedia mock (light in this case)
            expect(result.current.resolvedTheme).toBe("light");
        });
    });

    describe("Persistence", () => {
        it("persists theme to localStorage when cookie consent is given", () => {
            // Set cookie consent
            localStorage.setItem("singra-cookie-consent", JSON.stringify({ optional: true }));
            
            const { result } = renderHook(() => useTheme(), { wrapper });
            
            act(() => {
                result.current.setTheme("dark");
            });
            
            expect(localStorage.getItem("Singra-theme")).toBe("dark");
        });

        it("does not persist theme when cookie consent is not given", () => {
            // No consent set
            const { result } = renderHook(() => useTheme(), { wrapper });
            
            act(() => {
                result.current.setTheme("dark");
            });
            
            expect(localStorage.getItem("Singra-theme")).toBeNull();
        });

        it("loads theme from localStorage on mount", () => {
            localStorage.setItem("Singra-theme", "dark");
            
            const { result } = renderHook(() => useTheme(), { wrapper });
            
            expect(result.current.theme).toBe("dark");
            expect(result.current.resolvedTheme).toBe("dark");
        });

        it("handles corrupted localStorage data gracefully", () => {
            localStorage.setItem("singra-cookie-consent", "invalid-json{{{");
            
            const { result } = renderHook(() => useTheme(), { wrapper });
            
            act(() => {
                result.current.setTheme("dark");
            });
            
            // Should not persist due to parse error
            expect(localStorage.getItem("Singra-theme")).toBeNull();
            // But theme should still change in memory
            expect(result.current.theme).toBe("dark");
        });
    });

    describe("Document class management", () => {
        it("applies light class to document when theme is light", () => {
            const { result } = renderHook(() => useTheme(), { wrapper });
            
            act(() => {
                result.current.setTheme("light");
            });
            
            expect(document.documentElement.classList.contains("light")).toBe(true);
            expect(document.documentElement.classList.contains("dark")).toBe(false);
        });

        it("applies dark class to document when theme is dark", () => {
            const { result } = renderHook(() => useTheme(), { wrapper });
            
            act(() => {
                result.current.setTheme("dark");
            });
            
            expect(document.documentElement.classList.contains("dark")).toBe(true);
            expect(document.documentElement.classList.contains("light")).toBe(false);
        });

        it("removes previous class when changing theme", () => {
            const { result } = renderHook(() => useTheme(), { wrapper });
            
            act(() => {
                result.current.setTheme("dark");
            });
            
            expect(document.documentElement.classList.contains("dark")).toBe(true);
            
            act(() => {
                result.current.setTheme("light");
            });
            
            expect(document.documentElement.classList.contains("light")).toBe(true);
            expect(document.documentElement.classList.contains("dark")).toBe(false);
        });
    });

    describe("System preference changes", () => {
        it("updates resolvedTheme when system preference changes", () => {
            let mediaQueryCallback: () => void;
            
            Object.defineProperty(window, "matchMedia", {
                writable: true,
                value: vi.fn().mockImplementation((query) => ({
                    matches: query === "(prefers-color-scheme: dark)" ? false : false,
                    media: query,
                    onchange: null,
                    addListener: vi.fn(),
                    removeListener: vi.fn(),
                    addEventListener: vi.fn((event, callback) => {
                        if (event === "change") {
                            mediaQueryCallback = callback;
                        }
                    }),
                    removeEventListener: vi.fn(),
                    dispatchEvent: vi.fn(),
                })),
            });
            
            const { result } = renderHook(() => useTheme(), { wrapper: customWrapper("system") });
            
            expect(result.current.resolvedTheme).toBe("light");
            
            // Simulate system preference change to dark
            Object.defineProperty(window, "matchMedia", {
                writable: true,
                value: vi.fn().mockImplementation((query) => ({
                    matches: query === "(prefers-color-scheme: dark)" ? true : false,
                    media: query,
                    onchange: null,
                    addListener: vi.fn(),
                    removeListener: vi.fn(),
                    addEventListener: vi.fn(),
                    removeEventListener: vi.fn(),
                    dispatchEvent: vi.fn(),
                })),
            });
            
            act(() => {
                if (mediaQueryCallback) {
                    mediaQueryCallback();
                }
            });
            
            expect(result.current.resolvedTheme).toBe("dark");
        });
    });
});
