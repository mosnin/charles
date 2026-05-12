'use client';

/**
 * Approve / decline buttons for a paused agent run.
 * Calls POST /api/ai/task/resume/[pausedRunId] with { approved, callId }.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Check, X } from 'lucide-react';

interface InboxRunActionsProps {
  pausedRunId: string;
  callId?: string;
  slug: string;
}

export function InboxRunActions({ pausedRunId, callId, slug }: InboxRunActionsProps) {
  void slug; // reserved for future per-space routing
  const router = useRouter();
  const [pending, setPending] = useState<'approve' | 'decline' | null>(null);

  async function handle(action: 'approve' | 'decline') {
    if (pending) return;
    setPending(action);
    try {
      const res = await fetch(`/api/ai/task/resume/${pausedRunId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          approved: action === 'approve',
          ...(callId ? { callId } : {}),
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error((body as { error?: string }).error ?? 'Something went wrong.');
        setPending(null);
        return;
      }

      toast.success(
        action === 'approve'
          ? 'Approved. Charles will continue.'
          : 'Declined. Action cancelled.',
      );
      router.refresh();
    } catch {
      toast.error('Network error. Try again.');
      setPending(null);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => handle('approve')}
        disabled={pending !== null}
        className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md
                   bg-foreground text-background text-xs font-medium
                   transition-all duration-150 active:scale-[0.98]
                   focus-visible:ring-2 ring-ring/40 ring-offset-2 ring-offset-background
                   disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <Check size={13} />
        {pending === 'approve' ? 'Approving…' : 'Approve'}
      </button>

      <button
        onClick={() => handle('decline')}
        disabled={pending !== null}
        className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md
                   border border-border text-foreground text-xs font-medium
                   hover:bg-foreground/[0.04] transition-all duration-150
                   active:scale-[0.98]
                   focus-visible:ring-2 ring-ring/40 ring-offset-2 ring-offset-background
                   disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <X size={13} />
        {pending === 'decline' ? 'Declining…' : 'Decline'}
      </button>
    </div>
  );
}
