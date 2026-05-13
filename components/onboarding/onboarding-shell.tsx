'use client';

/**
 * OnboardingShell — the two-column canvas every onboarding question lives in.
 *
 * Left column carries the ASCII identity artwork; right column carries one
 * question at a time. Top-left holds an optional log-out pill. The shell is
 * calm and sparse on purpose — heavy whitespace, no progress bar, no chrome.
 */

import { ArrowLeft } from 'lucide-react';
import { AsciiPanel } from './ascii-panel';
import { cn } from '@/lib/utils';

interface OnboardingShellProps {
  artwork: 'sunflower' | 'wordmark';
  children: React.ReactNode;
  onLogout?: () => void;
}

export function OnboardingShell({
  artwork,
  children,
  onLogout,
}: OnboardingShellProps) {
  return (
    <div className="relative min-h-screen w-full bg-background text-foreground">
      {onLogout && (
        <button
          type="button"
          onClick={onLogout}
          className={cn(
            'absolute top-6 left-6 z-20',
            'inline-flex items-center gap-1.5',
            'rounded-full border border-border/70 bg-background/60 backdrop-blur',
            'px-3 py-1.5 text-xs text-muted-foreground',
            'hover:text-foreground hover:bg-muted/40 transition-colors',
          )}
        >
          <ArrowLeft className="size-3.5" />
          Log out
        </button>
      )}

      <div className="grid min-h-screen grid-cols-1 lg:grid-cols-2">
        {/* Left — ASCII identity */}
        <div className="hidden lg:flex items-center justify-center px-8">
          <AsciiPanel artwork={artwork} />
        </div>

        {/* Mobile ASCII (shrunk) */}
        <div className="flex lg:hidden items-center justify-center pt-16 pb-4">
          <AsciiPanel artwork={artwork} className="text-[8px]" />
        </div>

        {/* Right — question */}
        <div className="flex items-center justify-center px-12 lg:px-16 py-16">
          <div className="w-full max-w-md">{children}</div>
        </div>
      </div>
    </div>
  );
}
