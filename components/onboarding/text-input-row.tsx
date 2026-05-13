'use client';

/**
 * TextInputRow — a labeled single- or multi-line text field for onboarding.
 *
 * Label sits above the field in muted gray. Field is a calm rounded box with
 * a hairline border that thickens on focus. Used for free-text answers like
 * "your name", "company name", or "what are you building?".
 */

import { cn } from '@/lib/utils';

interface TextInputRowProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  multiline?: boolean;
}

export function TextInputRow({
  label,
  value,
  onChange,
  placeholder,
  autoFocus,
  multiline,
}: TextInputRowProps) {
  const fieldClass = cn(
    'w-full rounded-md border border-border/70 bg-background',
    'px-4 py-3 text-base text-foreground',
    'placeholder:text-muted-foreground/60',
    'focus:outline-none focus:border-foreground/40 transition-colors',
  );

  return (
    <label className="block space-y-2">
      <span className="block text-sm text-muted-foreground">{label}</span>
      {multiline ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoFocus={autoFocus}
          rows={4}
          className={cn(fieldClass, 'resize-none')}
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoFocus={autoFocus}
          className={fieldClass}
        />
      )}
    </label>
  );
}
