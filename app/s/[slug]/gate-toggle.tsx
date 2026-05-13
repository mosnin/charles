'use client';

/**
 * Single StageGate row with an optimistic toggle.
 *
 * The circle/check is the affordance. Click it, the local state flips, the
 * PATCH fires. If the server rejects, we revert and toast. router.refresh()
 * pulls the canonical state back on success so the rest of the page (advance
 * button, gate counts) stays in sync.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { CheckCircle2, Circle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface GateToggleProps {
  gateId: string;
  title: string;
  initialComplete: boolean;
}

export function GateToggle({ gateId, title, initialComplete }: GateToggleProps) {
  const router = useRouter();
  const [complete, setComplete] = useState(initialComplete);
  const [pending, startTransition] = useTransition();
  const [inflight, setInflight] = useState(false);

  async function toggle() {
    if (inflight) return;
    const next = !complete;
    setComplete(next);
    setInflight(true);
    try {
      const res = await fetch(`/api/stages/gates/${gateId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isComplete: next }),
      });
      if (!res.ok) {
        setComplete(!next);
        const body = await res.json().catch(() => ({}));
        toast.error((body as { error?: string }).error ?? 'Could not update.');
        return;
      }
      startTransition(() => router.refresh());
    } catch {
      setComplete(!next);
      toast.error('Network error. Try again.');
    } finally {
      setInflight(false);
    }
  }

  return (
    <li className="flex items-start gap-2.5 text-sm">
      <button
        type="button"
        onClick={toggle}
        aria-pressed={complete}
        aria-label={complete ? `Mark "${title}" incomplete` : `Mark "${title}" complete`}
        disabled={inflight}
        className={cn(
          'mt-0.5 flex-shrink-0 rounded-full transition-colors duration-150',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
          'disabled:cursor-not-allowed',
        )}
      >
        {complete ? (
          <CheckCircle2 size={15} className="text-foreground" />
        ) : (
          <Circle
            size={15}
            className="text-muted-foreground/40 hover:text-foreground/70 transition-colors duration-150"
          />
        )}
      </button>
      <span
        className={cn(
          'select-none',
          complete ? 'line-through text-muted-foreground' : 'text-foreground',
          pending && 'opacity-80',
        )}
      >
        {title}
      </span>
    </li>
  );
}
