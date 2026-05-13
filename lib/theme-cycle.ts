/**
 * Theme cycle helper.
 *
 * The workspace toggle cycles light -> dark -> system -> light. We keep the
 * pure function here (no React, no DOM) so it's trivially unit-testable and
 * the same logic can power any other surface that wants to advance themes.
 */

export type ThemeMode = 'light' | 'dark' | 'system';

const ORDER: readonly ThemeMode[] = ['light', 'dark', 'system'] as const;

/**
 * Return the next theme in the cycle. Anything we don't recognize (including
 * undefined on first render) is treated as 'system' so the cycle still
 * advances predictably.
 */
export function nextTheme(current: ThemeMode | string | undefined): ThemeMode {
  const safe: ThemeMode =
    current === 'light' || current === 'dark' || current === 'system' ? current : 'system';
  const idx = ORDER.indexOf(safe);
  return ORDER[(idx + 1) % ORDER.length];
}

/** Convenience: human-readable label for the current mode. */
export function themeLabel(mode: ThemeMode): string {
  if (mode === 'light') return 'Light';
  if (mode === 'dark') return 'Dark';
  return 'System';
}
