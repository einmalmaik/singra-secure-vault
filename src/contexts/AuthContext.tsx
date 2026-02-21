// Copyright (c) 2025-2026 Maunting Studios
// Licensed under the Business Source License 1.1 — see LICENSE
/**
 * @fileoverview Authentication Context for Singra Vault
 * 
 * Provides authentication state and methods throughout the application.
 * Handles Supabase auth state changes, login, signup, and OAuth flows.
 */

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  authReady: boolean;
  signUp: (email: string, password: string) => Promise<{ error: Error | null }>;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signInWithOAuth: (provider: 'google' | 'discord' | 'github') => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    // Set up auth state listener FIRST
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        console.debug(`[AuthContext] Auth state changed: ${event}`);
        setSession(session);
        setUser(session?.user ?? null);

        // Don't mark as ready/loaded on INITIAL_SESSION if we hold out for getSession
        if (event !== 'INITIAL_SESSION') {
          setLoading(false);
          setAuthReady(true);
        }
      }
    );

    // THEN check for existing session
    console.debug('[AuthContext] Calling getSession() to ensure token is fresh...');
    supabase.auth.getSession()
      .then(({ data: { session }, error }) => {
        if (error) {
          // Soft-Error: Session invalid oder Refresh fehlgeschlagen.
          // onAuthStateChange ist die kanonische Source of Truth —
          // keinen State überschreiben, finally löst authReady auf.
          console.warn(
            '[AuthContext] getSession() resolved with error — preserving existing auth state:',
            error
          );
          return;
        }
        console.debug('[AuthContext] getSession() resolved successfully.');
        setSession(session);
        setUser(session?.user ?? null);
      })
      .catch((error: unknown) => {
        // Log the failure but do NOT clear user/session state here.
        //
        // Rationale (Option B over Option A):
        // onAuthStateChange is the canonical source of truth for auth state.
        // It fires synchronously with INITIAL_SESSION *before* getSession()
        // resolves, so a valid user/session may already be set when this catch
        // runs. Unconditionally calling setUser(null) / setSession(null) here
        // would log out an already-authenticated user on a transient error
        // (storage lock, network hiccup, IndexedDB race).
        //
        // The finally block below still resolves authReady + loading, so the
        // app never hangs. If there genuinely was no session, onAuthStateChange
        // will have set user/session to null already.
        console.error('[AuthContext] getSession() failed — auth state preserved from onAuthStateChange:', error);
      })
      .finally(() => {
        // ALWAYS resolve auth state, regardless of success or failure.
        // Prevents permanent loading spinner when getSession rejects.
        setLoading(false);
        setAuthReady(true);
      });

    return () => subscription.unsubscribe();
  }, []);

  /**
   * Helper to get the redirect URL
   */
  const getRedirectUrl = () => {
    const currentOrigin = window.location.origin.replace(/\/$/, '');
    const currentHost = window.location.hostname.toLowerCase();
    const currentIsLocal =
      currentHost === 'localhost' ||
      currentHost === '127.0.0.1' ||
      currentHost === '[::1]';

    // Prefer window.location.origin if we're in the browser, as it's always accurate
    // for the currently running instance.
    if (typeof window !== 'undefined' && window.location && !currentIsLocal) {
      console.log('Using current origin for redirect:', currentOrigin);
      return currentOrigin;
    }

    let siteUrl = import.meta.env.VITE_SITE_URL?.trim();
    console.log('Site URL from env:', siteUrl);

    // Defensive fix for common typo (comma instead of dot)
    if (siteUrl && siteUrl.includes('mauntingstudios,de')) {
      console.warn('Detected typo in VITE_SITE_URL (comma instead of dot). Applying automatic fix.');
      siteUrl = siteUrl.replace('mauntingstudios,de', 'mauntingstudios.de');
    }

    if (!siteUrl) {
      return currentOrigin;
    }

    try {
      const configuredUrl = new URL(siteUrl);
      const configuredHost = configuredUrl.hostname.toLowerCase();
      const configuredIsLocal =
        configuredHost === 'localhost' ||
        configuredHost === '127.0.0.1' ||
        configuredHost === '[::1]';

      // Prevent production deployments from redirecting back to localhost.
      if (!currentIsLocal && configuredIsLocal) {
        console.warn('Ignoring localhost VITE_SITE_URL on non-localhost deployment.');
        return currentOrigin;
      }

      return configuredUrl.origin.replace(/\/$/, '');
    } catch {
      console.warn('Invalid VITE_SITE_URL. Falling back to current origin.');
      return currentOrigin;
    }
  };

  /**
   * Sign up with email and password
   */
  const signUp = async (email: string, password: string) => {
    const redirectUrl = `${getRedirectUrl()}/vault`;

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: redirectUrl,
      },
    });

    return { error: error as Error | null };
  };

  /**
   * Sign in with email and password
   */
  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    return { error: error as Error | null };
  };

  /**
   * Sign in with OAuth provider (Google, Discord, GitHub)
   */
  const signInWithOAuth = async (provider: 'google' | 'discord' | 'github') => {
    const redirectUrl = `${getRedirectUrl()}/vault`;
    console.log(`Starting OAuth with ${provider}, redirecting to: ${redirectUrl}`);
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: redirectUrl,
      },
    });

    return { error: error as Error | null };
  };

  /**
   * Sign out the current user
   */
  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      console.error('[AuthContext] signOut failed:', error);
      throw error;
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        loading,
        authReady,
        signUp,
        signIn,
        signInWithOAuth,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

/**
 * Hook to access authentication context
 * @returns Auth context with user, session, and auth methods
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
