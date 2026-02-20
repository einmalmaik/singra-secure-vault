// Copyright (c) 2025-2026 Maunting Studios
// Licensed under the Business Source License 1.1 — see LICENSE
/**
 * @fileoverview Theme Provider for Singra Vault
 * 
 * Provides a fixed dark theme context throughout the application.
 */

import { createContext, useContext, useEffect, ReactNode } from 'react';

type Theme = 'light' | 'dark' | 'system';

interface ThemeContextType {
  theme: 'dark';
  setTheme: (theme: Theme) => void;
  resolvedTheme: 'dark';
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const STORAGE_KEY = 'Singra-theme';

interface ThemeProviderProps {
  children: ReactNode;
  defaultTheme?: Theme;
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove('light', 'dark');
    root.classList.add('dark');
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  const setTheme = (_newTheme: Theme) => {
    // Dark mode is enforced globally.
  };

  return (
    <ThemeContext.Provider value={{ theme: 'dark', setTheme, resolvedTheme: 'dark' }}>
      {children}
    </ThemeContext.Provider>
  );
}

/**
 * Hook to access theme context
 * @returns Theme context with current theme and setter
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
