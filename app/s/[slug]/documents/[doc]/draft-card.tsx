'use client';

/**
 * "Draft this for me" card — shown above the editor on the product-prd doc
 * when the document is empty or nearly empty. One button, one quiet sentence,
 * and a small mono chip showing the per-hour cap. Founder-initiated only.
 *
 * On success we reload the page so the editor picks up the new content from
 * the server. Reload over client-side state because the editor mounts with
 * `content: initialContent` and re-rendering with a new prop would not reset
 * TipTap's internal document.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { BODY_MUTED, CAPTION, H3 } from '@/lib/typography';

interface DraftCardProps {
  endpoint: string;
  maxPerHour: number;
}

type Status =
  | { kind: 'idle' }
  | { kind: 'drafting' }
  | { kind: 'error'; message: string };

export function DraftCard({ endpoint, maxPerHour }: DraftCardProps) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  async function onDraft() {
    setStatus({ kind: 'drafting' });
    try {
      const res = await fetch(endpoint, { method: 'POST' });
      if (!res.ok) {
        let msg = 'Draft failed.';
        try {
          const body = (await res.json()) as { error?: string };
          if (body.error) msg = body.error;
        } catch {
          // keep default
        }
        setStatus({ kind: 'error', message: msg });
        return;
      }
      // Server has the new content — refresh so the editor remounts with it.
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Draft failed.';
      setStatus({ kind: 'error', message });
    }
  }

  const drafting = status.kind === 'drafting';

  return (
    <section
      className={cn(
        'rounded-xl border border-border/70 bg-background px-6 py-5',
        'flex items-start justify-between gap-6 print:hidden',
      )}
      aria-label="Draft this document for me"
    >
      <div className="space-y-1.5">
        <h2 className={H3}>Want a starting point?</h2>
        <p className={cn(BODY_MUTED, 'max-w-md text-sm')}>
          Charles can draft this from your mission. You can edit every word
          after.
        </p>
        {status.kind === 'error' && (
          <p className="text-xs text-[color:var(--charles-destructive,#8B1A1A)]">
            {status.message}
          </p>
        )}
      </div>
      <div className="flex flex-col items-end gap-2">
        <Button onClick={onDraft} disabled={drafting} size="sm">
          {drafting ? 'Drafting…' : 'Draft from mission'}
        </Button>
        <span
          className={cn(
            CAPTION,
            'rounded-full border border-border/60 bg-muted/30 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider',
          )}
        >
          {maxPerHour}/hr
        </span>
      </div>
    </section>
  );
}
