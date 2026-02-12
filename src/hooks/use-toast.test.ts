/**
 * @fileoverview Tests for use-toast hook
 * 
 * Phase 6: Context Provider and Hook Tests
 * Tests toast notification system (add, dismiss, limit).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useToast, toast } from "./use-toast";

// ============ Test Setup ============

beforeEach(() => {
    // Clear all toasts between tests
    const { result } = renderHook(() => useToast());
    act(() => {
        result.current.dismiss();
    });
    
    // Clear all timers
    vi.clearAllTimers();
});

afterEach(() => {
    vi.useRealTimers();
});

// ============ Tests ============

describe("useToast", () => {
    describe("toast()", () => {
        it("adds toast to the list", () => {
            const { result } = renderHook(() => useToast());
            
            act(() => {
                result.current.toast({
                    title: "Test toast",
                    description: "This is a test",
                });
            });
            
            expect(result.current.toasts).toHaveLength(1);
            expect(result.current.toasts[0].title).toBe("Test toast");
            expect(result.current.toasts[0].description).toBe("This is a test");
        });

        it("generates unique ID for each toast", () => {
            const { result } = renderHook(() => useToast());
            
            let id1: string;
            let id2: string;
            
            act(() => {
                const toast1 = result.current.toast({ title: "Toast 1" });
                id1 = toast1.id;
            });
            
            act(() => {
                result.current.dismiss();
            });
            
            act(() => {
                const toast2 = result.current.toast({ title: "Toast 2" });
                id2 = toast2.id;
            });
            
            expect(id1).not.toBe(id2);
        });

        it("respects TOAST_LIMIT (max 1 toast)", () => {
            const { result } = renderHook(() => useToast());
            
            act(() => {
                result.current.toast({ title: "Toast 1" });
            });
            
            act(() => {
                result.current.toast({ title: "Toast 2" });
            });
            
            // Only 1 toast should be present (newest one)
            expect(result.current.toasts).toHaveLength(1);
            expect(result.current.toasts[0].title).toBe("Toast 2");
        });

        it("returns object with id and dismiss function", () => {
            const { result } = renderHook(() => useToast());
            
            let toastResult;
            act(() => {
                toastResult = result.current.toast({ title: "Test" });
            });
            
            expect(toastResult).toHaveProperty("id");
            expect(toastResult).toHaveProperty("dismiss");
            expect(typeof toastResult.id).toBe("string");
            expect(typeof toastResult.dismiss).toBe("function");
        });
    });

    describe("dismiss()", () => {
        it("dismisses specific toast by ID", () => {
            vi.useFakeTimers();
            const { result } = renderHook(() => useToast());
            
            let toastId: string;
            act(() => {
                const t = result.current.toast({ title: "Test" });
                toastId = t.id;
            });
            
            expect(result.current.toasts).toHaveLength(1);
            
            act(() => {
                result.current.dismiss(toastId);
            });
            
            // Toast should be marked as closed (open: false)
            expect(result.current.toasts[0].open).toBe(false);
            
            // After delay, toast should be removed
            act(() => {
                vi.advanceTimersByTime(1000000);
            });
            
            expect(result.current.toasts).toHaveLength(0);
            
            vi.useRealTimers();
        });

        it("dismisses all toasts when called without ID", () => {
            vi.useFakeTimers();
            const { result } = renderHook(() => useToast());
            
            act(() => {
                result.current.toast({ title: "Toast 1" });
            });
            
            act(() => {
                result.current.dismiss();
            });
            
            // All toasts should be marked as closed
            expect(result.current.toasts.every(t => t.open === false)).toBe(true);
            
            // After delay, all toasts should be removed
            act(() => {
                vi.advanceTimersByTime(1000000);
            });
            
            expect(result.current.toasts).toHaveLength(0);
            
            vi.useRealTimers();
        });

        it("works with individual toast dismiss function", () => {
            vi.useFakeTimers();
            const { result } = renderHook(() => useToast());
            
            let toastDismiss: () => void;
            act(() => {
                const t = result.current.toast({ title: "Test" });
                toastDismiss = t.dismiss;
            });
            
            expect(result.current.toasts).toHaveLength(1);
            
            act(() => {
                toastDismiss();
            });
            
            // Toast should be marked as closed
            expect(result.current.toasts[0].open).toBe(false);
            
            vi.useRealTimers();
        });
    });

    describe("State synchronization", () => {
        it("synchronizes state across multiple useToast hook instances", () => {
            const { result: result1 } = renderHook(() => useToast());
            const { result: result2 } = renderHook(() => useToast());
            
            act(() => {
                result1.current.toast({ title: "Shared toast" });
            });
            
            // Both hooks should see the same toast
            expect(result1.current.toasts).toHaveLength(1);
            expect(result2.current.toasts).toHaveLength(1);
            expect(result1.current.toasts[0].id).toBe(result2.current.toasts[0].id);
        });
    });

    describe("Edge cases", () => {
        it("handles empty title and description", () => {
            const { result } = renderHook(() => useToast());
            
            act(() => {
                result.current.toast({ title: "", description: "" });
            });
            
            expect(result.current.toasts).toHaveLength(1);
            expect(result.current.toasts[0].title).toBe("");
            expect(result.current.toasts[0].description).toBe("");
        });

        it("handles toast with only title", () => {
            const { result } = renderHook(() => useToast());
            
            act(() => {
                result.current.toast({ title: "Only title" });
            });
            
            expect(result.current.toasts).toHaveLength(1);
            expect(result.current.toasts[0].title).toBe("Only title");
            expect(result.current.toasts[0].description).toBeUndefined();
        });

        it("handles toast with variant prop", () => {
            const { result } = renderHook(() => useToast());
            
            act(() => {
                result.current.toast({
                    title: "Error toast",
                    variant: "destructive",
                });
            });
            
            expect(result.current.toasts).toHaveLength(1);
            expect(result.current.toasts[0].variant).toBe("destructive");
        });
    });
});
