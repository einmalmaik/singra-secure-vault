// Copyright (c) 2025-2026 Maunting Studios
// Licensed under the Business Source License 1.1 — see LICENSE
/**
 * @fileoverview Tests for AuthContext
 * 
 * Phase 6: Context Provider and Hook Tests
 * Tests authentication context, state management, and auth methods.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { renderHook, act } from "@testing-library/react";
import { AuthProvider, useAuth } from "./AuthContext";
import { ReactNode } from "react";

// ============ Mocks ============

const mockSupabase = vi.hoisted(() => ({
    auth: {
        getSession: vi.fn(),
        onAuthStateChange: vi.fn(),
        signUp: vi.fn(),
        signInWithPassword: vi.fn(),
        signInWithOAuth: vi.fn(),
        signOut: vi.fn(),
    },
}));

vi.mock("@/integrations/supabase/client", () => ({
    supabase: mockSupabase,
}));

// ============ Test Setup ============

const mockUser = {
    id: "test-user-id",
    email: "test@example.com",
    app_metadata: {},
    user_metadata: {},
    aud: "authenticated",
    created_at: "2024-01-01T00:00:00Z",
};

const mockSession = {
    access_token: "test-token",
    refresh_token: "test-refresh",
    expires_in: 3600,
    token_type: "bearer",
    user: mockUser,
};

beforeEach(() => {
    vi.clearAllMocks();

    // Default: no session, auth state listener returns unsubscribe fn
    mockSupabase.auth.getSession.mockResolvedValue({
        data: { session: null },
        error: null,
    });

    mockSupabase.auth.onAuthStateChange.mockReturnValue({
        data: {
            subscription: {
                unsubscribe: vi.fn(),
            },
        },
    });
});

// ============ Helper: Wrapper Component ============

function wrapper({ children }: { children: ReactNode }) {
    return <AuthProvider>{children}</AuthProvider>;
}

// ============ Tests ============

describe("AuthContext", () => {
    describe("useAuth hook", () => {
        it("throws error when used outside AuthProvider", () => {
            // Suppress console.error for this test
            const consoleError = vi.spyOn(console, "error").mockImplementation(() => { });

            expect(() => {
                renderHook(() => useAuth());
            }).toThrow("useAuth must be used within an AuthProvider");

            consoleError.mockRestore();
        });
    });

    describe("Initial state", () => {
        it("starts with user=null, session=null, loading=true", async () => {
            const { result } = renderHook(() => useAuth(), { wrapper });

            // Initially loading
            expect(result.current.loading).toBe(true);
            expect(result.current.user).toBeNull();
            expect(result.current.session).toBeNull();

            // Wait for getSession to resolve
            await waitFor(() => {
                expect(result.current.loading).toBe(false);
            });
        });

        it("sets loading=false after getSession resolves", async () => {
            const { result } = renderHook(() => useAuth(), { wrapper });

            await waitFor(() => {
                expect(result.current.loading).toBe(false);
            });

            expect(mockSupabase.auth.getSession).toHaveBeenCalled();
        });
    });

    describe("signUp", () => {
        it("calls supabase.auth.signUp with correct parameters", async () => {
            mockSupabase.auth.signUp.mockResolvedValue({
                data: { user: mockUser, session: mockSession },
                error: null,
            });

            const { result } = renderHook(() => useAuth(), { wrapper });

            await waitFor(() => expect(result.current.loading).toBe(false));

            await act(async () => {
                await result.current.signUp("test@example.com", "password123");
            });

            expect(mockSupabase.auth.signUp).toHaveBeenCalledWith({
                email: "test@example.com",
                password: "password123",
                options: {
                    emailRedirectTo: expect.stringContaining("/vault"),
                },
            });
        });

        it("returns error when signup fails", async () => {
            const mockError = new Error("Email already exists");
            mockSupabase.auth.signUp.mockResolvedValue({
                data: { user: null, session: null },
                error: mockError,
            });

            const { result } = renderHook(() => useAuth(), { wrapper });

            await waitFor(() => expect(result.current.loading).toBe(false));

            let signUpResult;
            await act(async () => {
                signUpResult = await result.current.signUp("test@example.com", "password123");
            });

            expect(signUpResult.error).toBe(mockError);
        });
    });

    describe("signIn", () => {
        it("calls supabase.auth.signInWithPassword with correct parameters", async () => {
            mockSupabase.auth.signInWithPassword.mockResolvedValue({
                data: { user: mockUser, session: mockSession },
                error: null,
            });

            const { result } = renderHook(() => useAuth(), { wrapper });

            await waitFor(() => expect(result.current.loading).toBe(false));

            await act(async () => {
                await result.current.signIn("test@example.com", "password123");
            });

            expect(mockSupabase.auth.signInWithPassword).toHaveBeenCalledWith({
                email: "test@example.com",
                password: "password123",
            });
        });

        it("returns error when signin fails", async () => {
            const mockError = new Error("Invalid credentials");
            mockSupabase.auth.signInWithPassword.mockResolvedValue({
                data: { user: null, session: null },
                error: mockError,
            });

            const { result } = renderHook(() => useAuth(), { wrapper });

            await waitFor(() => expect(result.current.loading).toBe(false));

            let signInResult;
            await act(async () => {
                signInResult = await result.current.signIn("test@example.com", "wrongpass");
            });

            expect(signInResult.error).toBe(mockError);
        });
    });

    describe("signInWithOAuth", () => {
        it("calls supabase.auth.signInWithOAuth with google provider", async () => {
            mockSupabase.auth.signInWithOAuth.mockResolvedValue({
                data: { provider: "google", url: "https://accounts.google.com/..." },
                error: null,
            });

            const { result } = renderHook(() => useAuth(), { wrapper });

            await waitFor(() => expect(result.current.loading).toBe(false));

            await act(async () => {
                await result.current.signInWithOAuth("google");
            });

            expect(mockSupabase.auth.signInWithOAuth).toHaveBeenCalledWith({
                provider: "google",
                options: {
                    redirectTo: expect.stringContaining("/vault"),
                },
            });
        });

        it("calls supabase.auth.signInWithOAuth with discord provider", async () => {
            mockSupabase.auth.signInWithOAuth.mockResolvedValue({
                data: { provider: "discord", url: "https://discord.com/..." },
                error: null,
            });

            const { result } = renderHook(() => useAuth(), { wrapper });

            await waitFor(() => expect(result.current.loading).toBe(false));

            await act(async () => {
                await result.current.signInWithOAuth("discord");
            });

            expect(mockSupabase.auth.signInWithOAuth).toHaveBeenCalledWith({
                provider: "discord",
                options: {
                    redirectTo: expect.stringContaining("/vault"),
                },
            });
        });

        it("calls supabase.auth.signInWithOAuth with github provider", async () => {
            mockSupabase.auth.signInWithOAuth.mockResolvedValue({
                data: { provider: "github", url: "https://github.com/..." },
                error: null,
            });

            const { result } = renderHook(() => useAuth(), { wrapper });

            await waitFor(() => expect(result.current.loading).toBe(false));

            await act(async () => {
                await result.current.signInWithOAuth("github");
            });

            expect(mockSupabase.auth.signInWithOAuth).toHaveBeenCalledWith({
                provider: "github",
                options: {
                    redirectTo: expect.stringContaining("/vault"),
                },
            });
        });
    });

    describe("signOut", () => {
        it("calls supabase.auth.signOut", async () => {
            mockSupabase.auth.signOut.mockResolvedValue({ error: null });

            const { result } = renderHook(() => useAuth(), { wrapper });

            await waitFor(() => expect(result.current.loading).toBe(false));

            await act(async () => {
                await result.current.signOut();
            });

            expect(mockSupabase.auth.signOut).toHaveBeenCalled();
        });
    });

    describe("Auth state changes", () => {
        it("updates user and session on SIGNED_IN event", async () => {
            let authCallback: (event: string, session: unknown) => void;

            mockSupabase.auth.onAuthStateChange.mockImplementation((callback) => {
                authCallback = callback;
                return {
                    data: {
                        subscription: {
                            unsubscribe: vi.fn(),
                        },
                    },
                };
            });

            const { result } = renderHook(() => useAuth(), { wrapper });

            await waitFor(() => expect(result.current.loading).toBe(false));

            // Simulate SIGNED_IN event
            act(() => {
                authCallback("SIGNED_IN", mockSession);
            });

            await waitFor(() => {
                expect(result.current.user).toEqual(mockUser);
                expect(result.current.session).toEqual(mockSession);
            });
        });

        it("clears user and session on SIGNED_OUT event", async () => {
            let authCallback: (event: string, session: unknown) => void;

            mockSupabase.auth.onAuthStateChange.mockImplementation((callback) => {
                authCallback = callback;
                return {
                    data: {
                        subscription: {
                            unsubscribe: vi.fn(),
                        },
                    },
                };
            });

            // Start with a session
            mockSupabase.auth.getSession.mockResolvedValue({
                data: { session: mockSession },
                error: null,
            });

            const { result } = renderHook(() => useAuth(), { wrapper });

            await waitFor(() => {
                expect(result.current.user).toEqual(mockUser);
            });

            // Simulate SIGNED_OUT event
            act(() => {
                authCallback("SIGNED_OUT", null);
            });

            await waitFor(() => {
                expect(result.current.user).toBeNull();
                expect(result.current.session).toBeNull();
            });
        });

        it("updates session on TOKEN_REFRESHED event", async () => {
            let authCallback: (event: string, session: unknown) => void;

            mockSupabase.auth.onAuthStateChange.mockImplementation((callback) => {
                authCallback = callback;
                return {
                    data: {
                        subscription: {
                            unsubscribe: vi.fn(),
                        },
                    },
                };
            });

            const { result } = renderHook(() => useAuth(), { wrapper });

            await waitFor(() => expect(result.current.loading).toBe(false));

            const newSession = {
                ...mockSession,
                access_token: "new-token",
            };

            // Simulate TOKEN_REFRESHED event
            act(() => {
                authCallback("TOKEN_REFRESHED", newSession);
            });

            await waitFor(() => {
                expect(result.current.session?.access_token).toBe("new-token");
            });
        });
    });

    describe("Session restoration", () => {
        it("restores existing session on mount", async () => {
            mockSupabase.auth.getSession.mockResolvedValue({
                data: { session: mockSession },
                error: null,
            });

            const { result } = renderHook(() => useAuth(), { wrapper });

            await waitFor(() => {
                expect(result.current.user).toEqual(mockUser);
                expect(result.current.session).toEqual(mockSession);
                expect(result.current.loading).toBe(false);
            });
        });

        it("sets authReady=true and loading=false after getSession resolves (success path)", async () => {
            // Regression test for Bug 5:
            // authReady and loading must be resolved via the finally block,
            // ensuring they are set even if only the success path runs.
            mockSupabase.auth.getSession.mockResolvedValue({
                data: { session: mockSession },
                error: null,
            });

            const { result } = renderHook(() => useAuth(), { wrapper });

            await waitFor(() => {
                expect(result.current.authReady).toBe(true);
                expect(result.current.loading).toBe(false);
                expect(result.current.user).toEqual(mockUser);
            });
        });

        it("sets authReady=true and loading=false even when getSession rejects (no permanent spinner)", async () => {
            // Regression test for Bug 5 (P1): without .catch().finally(), a
            // getSession() rejection (storage corruption, IndexedDB lock,
            // network timeout) left loading=true and authReady=false forever.
            // The app showed a permanent spinner with no recovery path.
            const storageError = new Error("QuotaExceededError: localStorage is full");
            mockSupabase.auth.getSession.mockRejectedValue(storageError);

            const consoleError = vi.spyOn(console, "error").mockImplementation(() => { });

            const { result } = renderHook(() => useAuth(), { wrapper });

            await waitFor(() => {
                // Auth state must resolve — no permanent spinner
                expect(result.current.authReady).toBe(true);
                expect(result.current.loading).toBe(false);
            });

            // Rejection treated as unauthenticated — user must sign in again
            expect(result.current.user).toBeNull();
            expect(result.current.session).toBeNull();

            // Error must be logged (not silently swallowed)
            expect(consoleError).toHaveBeenCalledWith(
                expect.stringContaining("[AuthContext] getSession() failed"),
                storageError,
            );

            consoleError.mockRestore();
        });
    });
});
