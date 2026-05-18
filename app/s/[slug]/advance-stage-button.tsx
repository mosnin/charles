'use client';

/**
 * Stage-advance controls.
 *
 * Two visual states:
 *   - All gates complete → primary button "Advance to {Next}."
 *   - Some gates incomplete → quiet "Skip remaining gates and advance" link,
 *     opens an AlertDialog that names the count being skipped.
 *
 * Both paths POST to /api/stages/advance; the override flag distinguishes
 * them. On success, router.refresh() so the stepper, gate list, and counts
 * update from the server.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ArrowRight } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

interface AdvanceStageButtonProps {
  nextStageLabel: string;
  ready: boolean;
  incompleteCount: number;
}

export function AdvanceStageButton({
  nextStageLabel,
  ready,
  incompleteCount,
}: AdvanceStageButtonProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [, startTransition] = useTransition();
  const [dialogOpen, setDialogOpen] = useState(false);

  async function advance(override: boolean) {
    if (pending) return;
    setPending(true);
    try {
      const res = await fetch('/api/stages/advance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ override }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error((body as { error?: string }).error ?? 'Could not advance.');
        return;
      }
      toast.success(`Advanced to ${nextStageLabel}.`);
      setDialogOpen(false);
      startTransition(() => router.refresh());
    } catch {
      toast.error('Network error. Try again.');
    } finally {
      setPending(false);
    }
  }

  if (ready) {
    return (
      <button
        type="button"
        onClick={() => advance(false)}
        disabled={pending}
        className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-foreground text-background text-sm font-medium hover:opacity-90 transition-opacity duration-150 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {pending ? 'Advancing…' : `Advance to ${nextStageLabel}`}
        <ArrowRight size={13} />
      </button>
    );
  }

  const skippedLabel =
    incompleteCount === 1 ? '1 incomplete gate' : `${incompleteCount} incomplete gates`;

  return (
    <AlertDialog open={dialogOpen} onOpenChange={setDialogOpen}>
      <AlertDialogTrigger asChild>
        <button
          type="button"
          className="text-xs italic text-muted-foreground hover:text-foreground transition-colors duration-150"
        >
          Skip remaining gates and advance
        </button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Skip {skippedLabel}?</AlertDialogTitle>
          <AlertDialogDescription>
            You are advancing to {nextStageLabel} without completing every gate.
            You can come back and tick them off later.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={pending}
            onClick={(e) => {
              e.preventDefault();
              advance(true);
            }}
          >
            {pending ? 'Advancing…' : `Advance to ${nextStageLabel}`}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
