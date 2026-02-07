/**
 * @fileoverview Authentication Context for Singra PW
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

  useEffect(() => {
    // Set up auth state listener FIRST
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
        setLoading(false);
      }
    );

    // THEN check for existing session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  /**
   * Helper to get the redirect URL
   */
  const getRedirectUrl = () => {
    let siteUrl = import.meta.env.VITE_SITE_URL;

    // Defensive fix for common typo (comma instead of dot)
    if (siteUrl && siteUrl.includes('mauntingstudios,de')) {
      console.warn('Detected typo in VITE_SITE_URL (comma instead of dot). Applying automatic fix.');
      siteUrl = siteUrl.replace('mauntingstudios,de', 'mauntingstudios.de');
    }

    const origin = siteUrl ? siteUrl : window.location.origin;
    // Remove trailing slash if present to avoid double slashes when appending paths
    return origin.replace(/\/$/, '');
  };

  /**
   * Sign up with email and password
   */
  const signUp = async (email: string, password: string) => {
    const redirectUrl = `${getRedirectUrl()}/`;

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
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${getRedirectUrl()}/vault`,
      },
    });

    return { error: error as Error | null };
  };

  /**
   * Sign out the current user
   */
  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        loading,
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
export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
