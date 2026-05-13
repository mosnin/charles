'use client';

/**
 * Template card with apply action.
 *
 * One card per template. Serif name, blurb, chips, integration monograms,
 * primary Apply pill. Apply hits the route, surfaces a toast with what
 * was added, and refreshes the route so the home/sidebar reflects the
 * new state.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import {
  SERIF_CARD,
  BODY_MUTED,
  CAPTION,
  PRIMARY_PILL,
  MONO_CHIP,
} from '@/lib/typography';
import { cn } from '@/lib/utils';

interface IntegrationRef {
  toolkit: string;
  name: string;
}

interface TemplateCardProps {
  slug: string;
  name: string;
  blurb: string;
  highlights: readonly string[];
  integrations: readonly IntegrationRef[];
  spaceSlug: string;
}

export function TemplateCard({
  slug,
  name,
  blurb,
  highlights,
  integrations,
}: TemplateCardProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [submitting, setSubmitting] = useState(false);
  const busy = pending || submitting;

  async function apply() {
    if (busy) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/workspace-templates/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateSlug: slug }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        addedGates?: number;
        addedDocs?: number;
        updatedMission?: boolean;
      };
      if (!res.ok) {
        toast.error(data.error ?? `Apply failed (${res.status})`);
        return;
      }
      const bits: string[] = [];
      if (data.updatedMission) bits.push('mission filled');
      if ((data.addedGates ?? 0) > 0) bits.push(`${data.addedGates} gates`);
      if ((data.addedDocs ?? 0) > 0) bits.push(`${data.addedDocs} docs`);
      toast.success(
        bits.length > 0
          ? `Applied ${name}: ${bits.join(', ')}.`
          : `Applied ${name}. Nothing changed — already set up.`,
      );
      startTransition(() => router.refresh());
    } catch {
      toast.error('Network error. Try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-border/70 bg-background p-5 transition-colors hover:border-foreground/30">
      <div className="space-y-1.5">
        <h2 className={cn(SERIF_CARD, 'text-lg')}>{name}</h2>
        <p className={BODY_MUTED}>{blurb}</p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {highlights.map((h) => (
          <span
            key={h}
            className="inline-flex items-center rounded-full border border-border/70 px-2.5 py-0.5 text-[11px] text-muted-foreground"
          >
            {h}
          </span>
        ))}
      </div>

      {integrations.length > 0 && (
        <div className="space-y-2">
          <p className={cn(MONO_CHIP, 'text-muted-foreground')}>
            recommended apps
          </p>
          <div className="flex flex-wrap gap-1.5">
            {integrations.map((i) => (
              <span
                key={i.toolkit}
                title={i.name}
                className="inline-flex h-7 min-w-7 items-center justify-center rounded-md border border-border/70 bg-foreground/[0.02] px-2 text-[11px] font-medium text-foreground/80"
              >
                {monogram(i.name)}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="mt-auto flex items-center justify-between pt-2">
        <span className={CAPTION}>Empty fields only. Won&apos;t overwrite.</span>
        <button
          type="button"
          onClick={apply}
          disabled={busy}
          className={cn(
            PRIMARY_PILL,
            'disabled:cursor-not-allowed disabled:opacity-40',
          )}
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : null}
          {busy ? 'Applying' : 'Apply'}
        </button>
      </div>
    </div>
  );
}

function monogram(name: string): string {
  const parts = name.replace(/[()]/g, '').trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}
