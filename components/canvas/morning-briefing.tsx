'use client';

/**
 * MorningBriefing — the first thing a founder sees, once a day.
 *
 * Charles operates the company overnight; this is the surface that reports
 * back. Two columns: what happened while you were away, and what needs you
 * today (each action links to the surface that resolves it). It shows once
 * per local calendar day — dismiss or click an action and it stays gone
 * until tomorrow.
 *
 * Suppressed entirely on a rest day. A brand-new workspace and an
 * established-but-quiet one both report `isRestDay: true` from the builder;
 * in that case there is nothing to brief, so the surface says nothing and
 * leaves the canvas (and FirstMoveCard, on day one) to speak.
 *
 * Pattern mirrors FirstMoveCard: start hidden to avoid a flash, localStorage
 * gate, `canvas` / `inline` variants, `data-no-pan` so canvas panning
 * ignores it.
 */

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowRight, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { H2, SECTION_LABEL, BODY, BODY_MUTED, CAPTION, MONO_CHIP } from '@/lib/typography';
import { Sapling } from './sapling';
import type { DailyBriefingData } from '@/lib/briefing/build-daily-briefing';

const STORAGE_KEY = 'charles:briefing:last-seen';

/** Local calendar date as YYYY-MM-DD. Local, not UTC — the briefing is a
 *  per-founder daily moment, so it should turn over at the founder's midnight.
 *  Read and write both go through this, so the gate compare is always
 *  format-consistent. */
function todayLocal(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Greeting line — first name when we have one, plain second person otherwise. */
function briefingGreeting(firstName: string | null): string {
  return firstName ? `Good morning, ${firstName}.` : 'Good morning.';
}

interface MorningBriefingProps {
  slug: string;
  data: DailyBriefingData;
  /** Layout hint — fixed-positioned on the desktop canvas, inline on mobile. */
  variant?: 'canvas' | 'inline';
}

export function MorningBriefing({ slug, data, variant = 'canvas' }: MorningBriefingProps) {
  // Start hidden to avoid a flash before localStorage is read.
  const [seenToday, setSeenToday] = useState(true);

  useEffect(() => {
    setSeenToday(localStorage.getItem(STORAGE_KEY) === todayLocal());
  }, []);

  // Nothing to brief, or already seen today → say nothing.
  if (data.isRestDay || seenToday) return null;

  function markSeen() {
    localStorage.setItem(STORAGE_KEY, todayLocal());
    setSeenToday(true);
  }

  const greeting = briefingGreeting(data.founderFirstName);

  return (
    <div
      data-testid="morning-briefing"
      data-no-pan
      className={cn(
        'relative rounded-xl border border-border bg-background',
        variant === 'canvas'
          ? 'pointer-events-auto absolute left-1/2 top-16 z-30 w-[460px] -translate-x-1/2'
          : 'w-full',
      )}
    >
      <button
        type="button"
        onClick={markSeen}
        aria-label="Dismiss"
        className="absolute right-3 top-3 text-muted-foreground/50 transition-colors hover:text-muted-foreground"
      >
        <X size={15} />
      </button>

      {/* Header */}
      <div className="border-b border-border/60 px-5 py-4">
        <div className="flex items-center gap-2">
          <Sapling size={18} />
          <h2 className={H2}>{greeting}</h2>
        </div>
        <div className="mt-1.5 flex items-center gap-2">
          <p className={BODY_MUTED}>Here&apos;s where {data.workspaceName} stands.</p>
          <span className={cn(MONO_CHIP, 'shrink-0')}>{data.currentStage}</span>
        </div>
      </div>

      {/* Two columns */}
      <div className="grid grid-cols-1 gap-5 px-5 py-4 sm:grid-cols-2">
        <section>
          <p className={SECTION_LABEL}>While you were away</p>
          {data.yesterdayHighlights.length === 0 ? (
            <p className={cn(BODY_MUTED, 'mt-2')}>Nothing to report.</p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {data.yesterdayHighlights.map((line, i) => (
                <li key={i} className={cn(BODY, 'leading-snug')}>
                  {line}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <p className={SECTION_LABEL}>Needs you today</p>
          {data.needsYouToday.length === 0 ? (
            <p className={cn(BODY_MUTED, 'mt-2')}>Nothing needs you.</p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {data.needsYouToday.map((action, i) => (
                <li key={i}>
                  <Link
                    href={action.href}
                    onClick={markSeen}
                    className={cn(
                      BODY,
                      'group inline-flex items-center gap-1 leading-snug transition-colors hover:text-muted-foreground',
                    )}
                  >
                    {action.label}
                    <ArrowRight
                      size={13}
                      className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                    />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* Coming up — Charles's calendar. Suppressed when empty so the
          surface stays quiet for new workspaces with nothing scheduled. */}
      {data.comingUp.length > 0 && (
        <div className="border-t border-border/60 px-5 py-4">
          <p className={SECTION_LABEL}>Coming up</p>
          <ul className="mt-2 space-y-1.5">
            {data.comingUp.map((item) => (
              <li
                key={item.triggerId}
                className={cn(BODY, 'flex items-baseline gap-3 leading-snug')}
              >
                <span className={cn(CAPTION, 'shrink-0 tabular-nums')}>
                  {formatUpcomingWhen(item.runAt)}
                </span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">
                  {item.reason}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between border-t border-border/60 px-5 py-3">
        <p className={CAPTION}>
          {data.pendingApprovalsCount} pending &middot; {data.openTasksCount} open{' '}
          {data.openTasksCount === 1 ? 'task' : 'tasks'}
        </p>
        <button
          type="button"
          onClick={markSeen}
          className={cn(CAPTION, 'font-medium text-foreground transition-colors hover:text-muted-foreground')}
        >
          Got it
        </button>
      </div>
    </div>
  );
}

/**
 * Render a scheduled-wake timestamp as a tight human label. Today shows
 * just the time ("2:30 PM"), tomorrow shows "Tomorrow 9 AM", further out
 * shows the date ("May 22, 9 AM"). Keeps the calendar column scannable
 * without parking it next to a full ISO string.
 */
function formatUpcomingWhen(iso: string, now: Date = new Date()): string {
  const when = new Date(iso);
  const sameDay =
    when.getFullYear() === now.getFullYear() &&
    when.getMonth() === now.getMonth() &&
    when.getDate() === now.getDate();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const isTomorrow =
    when.getFullYear() === tomorrow.getFullYear() &&
    when.getMonth() === tomorrow.getMonth() &&
    when.getDate() === tomorrow.getDate();
  const time = when.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (sameDay) return time;
  if (isTomorrow) return `Tomorrow ${time}`;
  const date = when.toLocaleDateString([], { month: 'short', day: 'numeric' });
  return `${date}, ${time}`;
}

/** Pure helpers, exported for tests. */
export const _internals = { todayLocal, briefingGreeting, STORAGE_KEY };
