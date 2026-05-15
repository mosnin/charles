'use client';

/**
 * Approve / reject buttons for one paused AgentTask.
 *
 * Approve fires immediately — the founder already read the card, the
 * decision is made. Reject is a two-step: clicking Reject expands an
 * optional "tell Charles why" textarea + Confirm/Cancel; pressing Confirm
 * (with or without a reason) POSTs the cancellation. The reason is what
 * Charles uses to avoid proposing the same thing again — friction here is
 * net positive for the relationship over time.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ApprovalActionsProps {
  taskId: string;
  slug: string;
}

export function ApprovalActions({ taskId, slug }: ApprovalActionsProps) {
  // `slug` reserved for future per-workspace deep-links in toast actions.
  void slug;
  const router = useRouter();
  const [pending, setPending] = useState<'approve' | 'reject' | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState('');

  async function send(action: 'approve' | 'reject', rejectionReason?: string) {
    if (pending) return;
    setPending(action);

    try {
      const res = await fetch('/api/agent/approvals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId,
          action,
          ...(rejectionReason && rejectionReason.trim().length > 0
            ? { reason: rejectionReason.trim() }
            : {}),
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const msg = (body as { error?: string }).error ?? 'Something went wrong.';
        toast.error(msg);
        setPending(null);
        return;
      }

      if (action === 'approve') {
        toast.success('Approved. Charles will continue.');
      } else {
        toast.success('Rejected. Action cancelled.');
      }

      // Refresh the server component so the resolved item disappears.
      router.refresh();
    } catch {
      toast.error('Network error. Try again.');
      setPending(null);
    }
  }

  function startReject() {
    if (pending) return;
    setRejectOpen(true);
  }

  function cancelReject() {
    setRejectOpen(false);
    setReason('');
  }

  function confirmReject() {
    void send('reject', reason);
  }

  if (rejectOpen) {
    return (
      <div className="space-y-2 pl-0.5">
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Tell Charles why (optional). He'll avoid proposing this again."
          rows={2}
          maxLength={500}
          autoFocus
          className={cn(
            'w-full resize-none rounded-md border border-border bg-background',
            'px-3 py-2 text-sm leading-snug text-foreground placeholder:text-muted-foreground',
            'focus-visible:outline-none focus-visible:ring-2 ring-ring/40 ring-offset-2 ring-offset-background',
          )}
        />
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={confirmReject}
            disabled={pending !== null}
            className={cn(
              'inline-flex items-center gap-1.5 h-8 px-3 rounded-md',
              'bg-foreground text-background text-xs font-medium',
              'transition-all duration-150 active:scale-[0.98]',
              'focus-visible:ring-2 ring-ring/40 ring-offset-2 ring-offset-background',
              'disabled:opacity-50 disabled:cursor-not-allowed',
            )}
          >
            <X size={13} />
            {pending === 'reject' ? 'Rejecting…' : 'Confirm reject'}
          </button>
          <button
            type="button"
            onClick={cancelReject}
            disabled={pending !== null}
            className={cn(
              'inline-flex items-center h-8 px-3 rounded-md',
              'text-xs font-medium text-muted-foreground',
              'hover:text-foreground transition-colors',
              'disabled:opacity-50 disabled:cursor-not-allowed',
            )}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 pl-0.5">
      <button
        type="button"
        onClick={() => void send('approve')}
        disabled={pending !== null}
        className={cn(
          'inline-flex items-center gap-1.5 h-8 px-3 rounded-md',
          'bg-foreground text-background text-xs font-medium',
          'transition-all duration-150 active:scale-[0.98]',
          'focus-visible:ring-2 ring-ring/40 ring-offset-2 ring-offset-background',
          'disabled:opacity-50 disabled:cursor-not-allowed',
        )}
      >
        <Check size={13} />
        {pending === 'approve' ? 'Approving…' : 'Approve'}
      </button>

      <button
        type="button"
        onClick={startReject}
        disabled={pending !== null}
        className={cn(
          'inline-flex items-center gap-1.5 h-8 px-3 rounded-md',
          'border border-border text-foreground text-xs font-medium',
          'hover:bg-foreground/[0.04] transition-all duration-150',
          'active:scale-[0.98]',
          'focus-visible:ring-2 ring-ring/40 ring-offset-2 ring-offset-background',
          'disabled:opacity-50 disabled:cursor-not-allowed',
        )}
      >
        <X size={13} />
        Reject
      </button>
    </div>
  );
}
