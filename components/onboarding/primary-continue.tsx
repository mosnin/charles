'use client';

/**
 * PrimaryContinue — the single CTA at the bottom of each onboarding question.
 *
 * One button per screen by design. Rounded pill with a hairline border and a
 * trailing arrow. Disabled state goes pale, no shadow. Loading swaps the
 * arrow for a small spinner so the user knows the click took.
 */

import { ArrowRight, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PrimaryContinueProps {
  label?: string;
  showArrow?: boolean;
  disabled?: boolean;
  onClick: () => void;
  loading?: boolean;
}

export function PrimaryContinue({
  label = 'Continue',
  showArrow = true,
  disabled = false,
  onClick,
  loading = false,
}: PrimaryContinueProps) {
  const isDisabled = disabled || loading;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isDisabled}
      className={cn(
        'inline-flex items-center gap-2 rounded-lg px-8 py-3',
        'border border-border/70 bg-background text-sm',
        'transition-colors',
        isDisabled
          ? 'text-muted-foreground/50 cursor-not-allowed'
          : 'text-foreground shadow-sm hover:bg-muted/30',
      )}
    >
      <span>{label}</span>
      {showArrow &&
        (loading ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <ArrowRight className="size-4" />
        ))}
    </button>
  );
}
