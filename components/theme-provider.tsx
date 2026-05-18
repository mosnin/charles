'use client';

/**
 * ThemeProvider — wraps next-themes.
 *
 * next-themes does the heavy lifting (class strategy on <html>, localStorage,
 * SSR flash prevention, system-preference fallback). We expose two surfaces:
 *
 * 1. `useTheme()` — legacy two-state shape ({ theme, toggleTheme }) that
 *    older callers (clerk-sign-in, auth-page-layout, admin-shell,
 *    liquid-metal-button) depend on. `theme` here is the RESOLVED theme
 *    ('light' | 'dark'), and `toggleTheme` flips light <-> dark.
 *
 * 2. `useThemeMode()` — three-state shape ({ mode, resolved, setMode,
 *    cycleMode }) for the workspace toggle that supports system mode.
 *
 * The user-set mode is persisted under localStorage key `theme` so existing
 * stored preferences continue to work after this swap.
 */

import { ThemeProvider as NextThemesProvider, useTheme as useNextTheme } from 'next-themes';
import { useCallback, useMemo } from 'react';

import { nextTheme, type ThemeMode } from '@/lib/theme-cycle';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      storageKey="theme"
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}

/**
 * Legacy two-state hook. `theme` is the RESOLVED theme (never 'system'),
 * `toggleTheme` flips light <-> dark and writes the explicit choice.
 */
export function useTheme(): { theme: 'light' | 'dark'; toggleTheme: () => void } {
  const { resolvedTheme, setTheme } = useNextTheme();
  const resolved: 'light' | 'dark' = resolvedTheme === 'dark' ? 'dark' : 'light';

  const toggleTheme = useCallback(() => {
    setTheme(resolved === 'dark' ? 'light' : 'dark');
  }, [resolved, setTheme]);

  return useMemo(() => ({ theme: resolved, toggleTheme }), [resolved, toggleTheme]);
}

/**
 * Three-state hook for the workspace toggle.
 * - `mode` is the user's choice: 'light' | 'dark' | 'system'.
 * - `resolved` is what's actually rendered: 'light' | 'dark'.
 * - `cycleMode` advances light -> dark -> system -> light.
 */
export function useThemeMode(): {
  mode: ThemeMode;
  resolved: 'light' | 'dark';
  setMode: (m: ThemeMode) => void;
  cycleMode: () => void;
} {
  const { theme, resolvedTheme, setTheme } = useNextTheme();
  const mode: ThemeMode =
    theme === 'light' || theme === 'dark' || theme === 'system' ? theme : 'system';
  const resolved: 'light' | 'dark' = resolvedTheme === 'dark' ? 'dark' : 'light';

  const cycleMode = useCallback(() => {
    setTheme(nextTheme(mode));
  }, [mode, setTheme]);

  return { mode, resolved, setMode: setTheme, cycleMode };
}
