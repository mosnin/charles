'use client';

/**
 * Stages-kanban task card.
 *
 * One gate, one card. Pixel icon left, title + subtitle middle, an arrow
 * (or a quiet check) on the right. Three visual states:
 *
 *   - current  → white card, full opacity, toggle + arrow live.
 *   - past     → checked, line-through title, still toggleable to undo.
 *   - future   → 50% opacity, no shadow, not clickable. The founder hasn't
 *                got here yet — show the destination but don't beckon.
 *
 * The toggle is an optimistic PATCH to /api/stages/gates/[gateId]. Mirrors
 * the existing gate-toggle.tsx pattern but inline so the card owns its own
 * loading state without a wrapper indirection.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { toast } from 'sonner';
import { ArrowRight, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { GateTaskKind } from '@/lib/stages/canvas-helpers';
import { subtitleFor } from '@/lib/stages/canvas-helpers';
import type { Stage } from '@/lib/stages/catalog';
import { iconForStageGate } from '@/lib/icons/manifest';

/** Visual + interaction state for the card. */
export type CardState = 'past' | 'current' | 'future';

interface Props {
  id: string;
  slug: string;
  title: string;
  kind: GateTaskKind;
  isComplete: boolean;
  stage: Stage;
  state: CardState;
  /** A placeholder gate is rendered from the catalog, not the DB — no toggle. */
  isPlaceholder?: boolean;
}

export function TaskCard({
  id,
  slug,
  title,
  kind,
  isComplete: initialComplete,
  state,
  isPlaceholder = false,
}: Props) {
  const router = useRouter();
  const [complete, setComplete] = useState(initialComplete);
  const [, startTransition] = useTransition();
  const [inflight, setInflight] = useState(false);

  const isFuture = state === 'future';
  const canToggle = !isPlaceholder && !isFuture;
  const canNavigate = !isPlaceholder && !isFuture;

  async function toggle() {
    if (!canToggle || inflight) return;
    const next = !complete;
    setComplete(next);
    setInflight(true);
    try {
      const res = await fetch(`/api/stages/gates/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isComplete: next }),
      });
      if (!res.ok) {
        setComplete(!next);
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(body.error ?? 'Could not update.');
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

  const iconSrc = iconForStageGate(title);
  const subtitle = subtitleFor(kind);

  return (
    <div
      data-gate-id={id}
      data-card-state={state}
      className={cn(
        'group relative flex items-center gap-3 rounded-2xl border bg-white px-3 py-3',
        'transition-opacity duration-150',
        isFuture
          ? 'border-zinc-200 opacity-50'
          : 'border-zinc-200 shadow-[0_1px_2px_rgba(0,0,0,0.04)]',
      )}
    >
      {/* Icon tile */}
      <button
        type="button"
        onClick={toggle}
        disabled={!canToggle || inflight}
        aria-pressed={complete}
        aria-label={
          canToggle
            ? complete
              ? `Mark "${title}" incomplete`
              : `Mark "${title}" complete`
            : title
        }
        className={cn(
          'flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl border border-zinc-200 bg-zinc-50',
          canToggle && 'hover:bg-zinc-100 transition-colors duration-150',
          canToggle ? 'cursor-pointer' : 'cursor-default',
        )}
      >
        {complete ? (
          <Check size={16} className="text-emerald-700" />
        ) : (
          <Image
            src={iconSrc}
            alt=""
            width={24}
            height={24}
            className="pixelated"
            aria-hidden
          />
        )}
      </button>

      {/* Title + subtitle */}
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            'truncate text-[14px] font-medium leading-5 text-zinc-900',
            complete && 'line-through text-zinc-500',
          )}
        >
          {title}
        </p>
        <p className="truncate font-mono text-[11px] uppercase tracking-wide text-zinc-500">
          {subtitle}
        </p>
      </div>

      {/* Arrow → tasks page (future stages: hidden) */}
      {canNavigate ? (
        <Link
          href={`/s/${slug}/tasks?gate=${encodeURIComponent(id)}`}
          aria-label={`Open ${title}`}
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 transition-colors duration-150"
        >
          <ArrowRight size={15} />
        </Link>
      ) : (
        <span aria-hidden className="h-8 w-8 flex-shrink-0" />
      )}
    </div>
  );
}
