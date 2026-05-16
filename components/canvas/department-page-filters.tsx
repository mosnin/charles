'use client';

/**
 * Filter pills + filtered list for the unified department page.
 *
 * One row of pills ("All" + each config category). Selecting a pill
 * narrows the list. State is client-only — the URL doesn't change. The
 * server pre-rendered the unfiltered list; this island re-renders the
 * client-side view based on the selection.
 *
 * The list itself lives in this island too because the filtering happens
 * here; the server template just passes the entries and the config in.
 */

import { useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { BODY, BODY_MUTED, CAPTION } from '@/lib/typography';
import type { DepartmentFeedEntry } from '@/lib/departments/feed';
import type { FilterCategory } from '@/lib/departments/page-config';

interface Props {
  entries: DepartmentFeedEntry[];
  filters: readonly FilterCategory[];
  /** Empty-state CTA — link to the integrations page so the founder can
   *  connect more toolkits. */
  integrationsHref: string;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function statusDotClass(kind: DepartmentFeedEntry['kind']): string {
  switch (kind) {
    case 'agent_run_failed':
    case 'draft_declined':
    case 'paused_run_declined':
    case 'integration_disconnected':
      return 'bg-red-500';
    case 'agent_run_completed':
    case 'draft_accepted':
    case 'paused_run_approved':
    case 'integration_connected':
    case 'gate_completed':
    case 'stage_advanced':
      return 'bg-emerald-500';
    case 'agent_run_started':
      return 'bg-amber-500';
    default:
      return 'bg-muted-foreground';
  }
}

export function DepartmentPageFilters({ entries, filters, integrationsHref }: Props) {
  const [active, setActive] = useState<string>('all');

  const visible =
    active === 'all' ? entries : entries.filter((e) => e.category === active);

  const totalByFilter: Record<string, number> = { all: entries.length };
  for (const f of filters) totalByFilter[f.slug] = 0;
  for (const e of entries) {
    if (totalByFilter[e.category] != null) totalByFilter[e.category]++;
  }

  return (
    <div className="space-y-4">
      {/* Filter pills */}
      <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Filter">
        <FilterPill
          label="All"
          count={totalByFilter.all}
          isActive={active === 'all'}
          onClick={() => setActive('all')}
        />
        {filters.map((f) => (
          <FilterPill
            key={f.slug}
            label={f.label}
            count={totalByFilter[f.slug] ?? 0}
            isActive={active === f.slug}
            onClick={() => setActive(f.slug)}
          />
        ))}
      </div>

      {/* Feed */}
      {visible.length === 0 ? (
        <EmptyFeed isFiltered={active !== 'all'} integrationsHref={integrationsHref} />
      ) : (
        <ul className="divide-y divide-border/60">
          {visible.map((entry) => (
            <li key={entry.id} className="py-3 flex items-start gap-3">
              <span
                className={cn(
                  'mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full',
                  statusDotClass(entry.kind),
                )}
                aria-hidden
              />
              <div className="min-w-0 flex-1 space-y-0.5">
                <p className={cn(BODY, 'leading-snug break-words')}>{entry.summary}</p>
                <p className={CAPTION}>{relativeTime(entry.occurredAt)}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FilterPill({
  label,
  count,
  isActive,
  onClick,
}: {
  label: string;
  count: number;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={isActive}
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium',
        'border transition-colors',
        isActive
          ? 'border-foreground bg-foreground text-background'
          : 'border-border text-foreground hover:bg-foreground/[0.04]',
      )}
    >
      <span>{label}</span>
      <span
        className={cn(
          'tabular-nums',
          isActive ? 'text-background/70' : 'text-muted-foreground',
        )}
      >
        {count}
      </span>
    </button>
  );
}

function EmptyFeed({
  isFiltered,
  integrationsHref,
}: {
  isFiltered: boolean;
  integrationsHref: string;
}) {
  return (
    <div className="rounded-xl border border-dashed border-border/70 bg-muted/20 px-5 py-10 text-center">
      <p className={BODY}>
        {isFiltered ? 'Nothing in this category yet.' : 'Nothing yet.'}
      </p>
      <p className={cn(BODY_MUTED, 'mt-1.5')}>
        {isFiltered
          ? 'Try another filter, or ask Charles to start working here.'
          : "When Charles works in this department, you'll see it here."}
      </p>
      <Link
        href={integrationsHref}
        className={cn(
          CAPTION,
          'mt-4 inline-flex items-center gap-1 font-medium text-foreground hover:text-muted-foreground transition-colors',
        )}
      >
        Manage integrations <ArrowUpRight size={11} />
      </Link>
    </div>
  );
}
