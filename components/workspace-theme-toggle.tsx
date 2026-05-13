'use client';

/**
 * WorkspaceThemeToggle — the only theme control on the workspace shell.
 *
 * One small icon button. Tap to cycle light -> dark -> system -> light.
 * The icon reflects the user's explicit choice:
 *   - light  → Sun
 *   - dark   → Moon
 *   - system → Monitor
 *
 * On first render (before next-themes has hydrated) we render a neutral
 * placeholder of the same size, so the bar doesn't shift width on mount.
 * No tooltip lib is pulled in — `title=` is enough, and it keeps the
 * bundle clean.
 */

import { useEffect, useState } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';

import { useThemeMode } from '@/components/theme-provider';
import { themeLabel } from '@/lib/theme-cycle';

const BTN_CLASS =
  'inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-foreground/[0.04] transition-colors';

export function WorkspaceThemeToggle() {
  const { mode, cycleMode } = useThemeMode();

  // next-themes returns the persisted theme only after hydration. Render a
  // matching-size empty button on the server / first paint to avoid layout
  // shift, and reveal the real icon once we know the mode.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return <span aria-hidden className={BTN_CLASS} />;
  }

  const Icon = mode === 'light' ? Sun : mode === 'dark' ? Moon : Monitor;
  const label = themeLabel(mode);

  return (
    <button
      type="button"
      onClick={cycleMode}
      className={BTN_CLASS}
      title={`Theme: ${label}. Click to switch.`}
      aria-label={`Theme: ${label}. Click to switch.`}
    >
      <Icon size={16} />
    </button>
  );
}
