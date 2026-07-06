// Copyright (c) 2025-2026 Maunting Studios
// Licensed under the Business Source License 1.1 - see LICENSE
/**
 * @fileoverview Authentication Context for Singra Vault.
 *
 * React-facing auth state is intentionally thin. Persistence, refresh,
 * Tauri keychain access, BFF hydration and offline identity live in
 * authSessionManager so the same rules are shared by Web, PWA and Tauri.
 */

import { createContext, useCallback, useContext, useEffect, useRef, useState, ReactNode } from "react";
import type { User, Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import {
  AuthMode,
  clearPersistentSession,
  hydrateAuthSession,
  invalidateBffSession,
  isInIframe,
  persistAuthenticatedSession,
  startAuthSessionKeepAlive,
} from "@/services/authSessionManager";
import {
  AUTH_SESSION_RETENTION_CHANGED_EVENT,
  getAuthSessionRetentionDelayMs,
  recordAuthSessionActivity,
} from "@/services/authSessionRetentionPolicy";
import { isTauriRuntime } from "@/platform/runtime";
import { disableTauriDevAuthBypass } from "@/platform/tauriDevMode";

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  authReady: boolean;
  authMode: AuthMode;
  isOfflineSession: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [authReady, setAuthReady] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>("unauthenticated");
  const sessionRef = useRef<Session | null>(null);

  const applySessionState = useCallback((nextSession: Session | null, nextUser: User | null, nextMode: AuthMode) => {
    sessionRef.current = nextSession;
    setSession(nextSession);
    setUser(nextUser);
    setAuthMode(nextMode);
  }, []);

  useEffect(() => {
    disableTauriDevAuthBypass();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, currentSession) => {
        console.debug(`[AuthContext] Memory auth state changed: ${event}`);

        if (currentSession?.access_token) {
          applySessionState(currentSession, currentSession.user, "online");
          void persistAuthenticatedSession(currentSession).catch((error) => {
            console.warn("[AuthContext] Failed to persist auth session:", error);
          });
        } else if (event === "SIGNED_OUT") {
          applySessionState(null, null, "unauthenticated");
        }

        if (event !== "INITIAL_SESSION") {
          setLoading(false);
          setAuthReady(true);
        }
      },
    );

    const hydrateSession = async () => {
      try {
        const hydrated = await hydrateAuthSession();

        // If Supabase already emitted a valid INITIAL_SESSION, do not overwrite
        // it with a negative BFF result that may simply be a transient network miss.
        if (hydrated.mode === "online" || (!sessionRef.current && hydrated.mode !== "unauthenticated")) {
          applySessionState(hydrated.session, hydrated.user, hydrated.mode);
        }
      } catch (err) {
        console.warn("[AuthContext] No active persisted session found.", err);
      } finally {
        setLoading(false);
        setAuthReady(true);
      }
    };

    void hydrateSession();

    return () => subscription.unsubscribe();
  }, [applySessionState]);

  useEffect(() => {
    if (!authReady || authMode !== "online" || !session?.access_token) {
      return undefined;
    }

    return startAuthSessionKeepAlive({
      getSession: () => sessionRef.current,
      onSessionRefreshed: (refreshedSession) => {
        applySessionState(refreshedSession, refreshedSession.user, "online");
      },
    });
  }, [applySessionState, authMode, authReady, session?.access_token]);

  const signOut = useCallback(async () => {
    await clearPersistentSession();

    const { error: signOutError } = await supabase.auth.signOut();
    if (signOutError) {
      console.error("[AuthContext] Failed to terminate GoTrue session:", signOutError);
      throw signOutError;
    }

    if (!isInIframe() && !isTauriRuntime()) {
      const invalidated = await invalidateBffSession();
      if (!invalidated) {
        console.error("[AuthContext] Failed to invalidate BFF session.");
      }
    }

    applySessionState(null, null, "unauthenticated");
  }, [applySessionState]);

  useEffect(() => {
    if (!authReady || authMode !== "online" || !session?.access_token) {
      return undefined;
    }

    let stopped = false;
    let retentionTimer: ReturnType<typeof setTimeout> | null = null;

    const clearRetentionTimer = () => {
      if (retentionTimer) {
        clearTimeout(retentionTimer);
        retentionTimer = null;
      }
    };

    const scheduleRetentionCheck = () => {
      clearRetentionTimer();
      const delayMs = getAuthSessionRetentionDelayMs();
      if (delayMs === null || stopped) {
        return;
      }

      retentionTimer = setTimeout(() => {
        void signOut().catch(() => undefined);
      }, delayMs);
    };

    const handleActivity = () => {
      recordAuthSessionActivity();
      scheduleRetentionCheck();
    };

    recordAuthSessionActivity();
    scheduleRetentionCheck();

    window.addEventListener("pointerdown", handleActivity, { passive: true });
    window.addEventListener("keydown", handleActivity);
    window.addEventListener("focus", handleActivity);
    window.addEventListener(AUTH_SESSION_RETENTION_CHANGED_EVENT, scheduleRetentionCheck);

    return () => {
      stopped = true;
      clearRetentionTimer();
      window.removeEventListener("pointerdown", handleActivity);
      window.removeEventListener("keydown", handleActivity);
      window.removeEventListener("focus", handleActivity);
      window.removeEventListener(AUTH_SESSION_RETENTION_CHANGED_EVENT, scheduleRetentionCheck);
    };
  }, [authMode, authReady, session?.access_token, signOut]);

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        loading,
        authReady,
        authMode,
        isOfflineSession: authMode === "offline",
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }

  return context;
}
