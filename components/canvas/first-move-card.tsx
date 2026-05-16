'use client';

/**
 * FirstMoveCard — the day-one bridge on the canvas.
 *
 * A freshly-onboarded founder lands on CanvasHome and sees six idle
 * departments orbiting their mission. Meanwhile Charles already wrote them
 * a welcome message and queued a first task during onboarding — both
 * sitting one click away in the chat dock and the Tasks tab, unseen.
 *
 * This card closes that gap. It shows only while the workspace has no
 * agent activity yet (the parent gates it on that), and disappears the
 * moment Charles starts running work — or when the founder dismisses it.
 * Dismiss state is localStorage, same low-stakes pattern as the rest of
 * the canvas chrome.
 */

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowRight, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Sapling } from './sapling';

const STORAGE_KEY = 'charles-first-move-dismissed';

interface FirstMoveCardProps {
  slug: string;
  /** Layout hint — fixed-positioned on the desktop canvas, inline on mobile. */
  variant?: 'canvas' | 'inline';
}

export function FirstMoveCard({ slug, variant = 'canvas' }: FirstMoveCardProps) {
  // Start hidden to avoid a flash before localStorage is read.
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    setDismissed(localStorage.getItem(STORAGE_KEY) === 'true');
  }, []);

  if (dismissed) return null;

  function dismiss() {
    localStorage.setItem(STORAGE_KEY, 'true');
    setDismissed(true);
  }

  return (
    <div
      data-testid="first-move-card"
      data-no-pan
      className={cn(
        'pointer-events-auto relative rounded-xl border border-border bg-background px-4 py-4',
        variant === 'canvas'
          ? 'absolute bottom-5 left-1/2 z-20 w-[340px] -translate-x-1/2'
          : 'w-full',
      )}
    >
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="absolute right-2 top-2 text-muted-foreground/50 transition-colors hover:text-muted-foreground"
      >
        <X size={14} />
      </button>

      <div className="flex items-center gap-2">
        <Sapling size={18} />
        <p className="text-sm font-semibold text-foreground">Charles is ready.</p>
      </div>
      <p className="mt-1 text-sm leading-[1.5] text-muted-foreground">
        He left you a note in the chat — and a first task to get started.
      </p>

      <div className="mt-3 flex items-center gap-4">
        <Link
          href={`/s/${slug}/chat`}
          className="inline-flex items-center gap-1 text-sm font-medium text-foreground transition-colors hover:text-muted-foreground"
        >
          Open the chat
          <ArrowRight size={13} />
        </Link>
        <Link
          href={`/s/${slug}/tasks`}
          className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          See the task
        </Link>
      </div>
    </div>
  );
}
