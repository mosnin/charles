'use client';

/**
 * Approve / dismiss buttons for an AgentDraft.
 * PATCH /api/agent/drafts/[id] with { action: 'approve' | 'dismiss' }.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Check, X } from 'lucide-react';

interface DraftActionsProps {
  draftId: string;
  slug: string;
}

export function DraftActions({ draftId, slug }: DraftActionsProps) {
  void slug;
  const router = useRouter();
  const [pending, setPending] = useState<'approve' | 'dismiss' | null>(null);

  async function handle(action: 'approve' | 'dismiss') {
    if (pending) return;
    setPending(action);
    try {
      const res = await fetch(`/api/agent/drafts/${draftId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error((body as { error?: string }).error ?? 'Something went wrong.');
        setPending(null);
        return;
      }

      toast.success(
        action === 'approve' ? 'Draft approved.' : 'Draft dismissed.',
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
        onClick={() => handle('dismiss')}
        disabled={pending !== null}
        className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md
                   border border-border text-foreground text-xs font-medium
                   hover:bg-foreground/[0.04] transition-all duration-150
                   active:scale-[0.98]
                   focus-visible:ring-2 ring-ring/40 ring-offset-2 ring-offset-background
                   disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <X size={13} />
        {pending === 'dismiss' ? 'Dismissing…' : 'Dismiss'}
      </button>
    </div>
  );
}
