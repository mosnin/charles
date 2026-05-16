'use client';

/**
 * Right-edge chat dock — the always-present surface for talking to Charles.
 *
 * Five tabs (Home, Company, Charles, Tasks, Library), a message thread, a
 * single-line prompt input. The dock collapses to a 32px rail; the state
 * persists in localStorage so the founder's preference survives reloads.
 *
 * The Home tab renders the latest audit-feed events — sub-agent activity
 * as SubagentChips, everything else as a one-line text row. The initial
 * payload is rendered server-side (no flash); the dock then polls
 * `/api/space/[slug]/audit-feed?limit=8` every 30s and refreshes on focus.
 *
 * Realtime push lives in Wave 3 — this pass intentionally uses polling so
 * we don't take on a new Supabase subscription contract in the same wave.
 *
 * Responsive contract:
 *   - Default ("desktop") variant: hidden below md, 420px right-docked at md+.
 *     The CanvasHome renders a separate mobile chat overlay anchored to a FAB.
 *   - "mobile" variant: full-width, always visible, no collapse rail. Used
 *     inside the mobile full-screen overlay so the founder gets the same
 *     content (5 tabs, audit feed, prompt input) on a small screen.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { ArrowRight, ChevronRight, ChevronLeft, MessageSquare } from 'lucide-react';
import { cn } from '@/lib/utils';
import { MONO_META } from '@/lib/typography';
import { timeAgo } from '@/lib/formatting';
import { iconForDepartment } from '@/lib/icons/manifest';
import type { AuditEvent } from '@/lib/observability/audit-feed';
import { eventsToDockRows, type DockRow } from '@/lib/canvas/dock-feed';
import { SubagentChip } from './subagent-chip';
import { LibraryTab } from './library-tab';
import { useOnRealtimeTick } from '@/lib/convex/use-realtime-ticks';

const TABS = ['Home', 'Company', 'Charles', 'Tasks', 'Library'] as const;
type Tab = (typeof TABS)[number];

const STORAGE_KEY = 'charles:chat-dock:collapsed';

interface Props {
  slug: string;
  /** Space id — required for the Convex realtime subscription that
   *  replaced the polling timer. */
  spaceId: string;
  /** Server-rendered initial events. Refreshed in-place when a new
   *  Convex audit tick arrives or the window regains focus. */
  initialAuditFeed: AuditEvent[];
  /**
   * "desktop" (default): hidden below md, 420px right-docked at md+.
   * "mobile": full-width, no collapse rail. Used inside the mobile overlay.
   */
  variant?: 'desktop' | 'mobile';
}

export function ChatDock({ slug, spaceId, initialAuditFeed, variant = 'desktop' }: Props) {
  const router = useRouter();
  const [collapsed, setCollapsed] = useState<boolean>(false);
  const isMobile = variant === 'mobile';
  const [tab, setTab] = useState<Tab>('Home');
  const [value, setValue] = useState('');
  const [events, setEvents] = useState<AuditEvent[]>(initialAuditFeed);
  const inputRef = useRef<HTMLInputElement>(null);

  // Hydrate collapsed state from localStorage on mount.
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === '1') setCollapsed(true);
    } catch {
      // localStorage unavailable — keep default.
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/space/${slug}/audit-feed?limit=8`, {
        cache: 'no-store',
      });
      if (!res.ok) return;
      const data = (await res.json()) as AuditEvent[];
      if (Array.isArray(data)) setEvents(data);
    } catch {
      // Network blips don't matter — we'll try again on the next tick.
    }
  }, [slug]);

  // Re-fetch on window focus as a safety net (Convex disconnects, sleep,
  // unauthenticated state). The polling timer that used to live here is
  // gone — live pushes come from `realtimeTicks` of kind=audit below.
  useEffect(() => {
    const onFocus = () => {
      void refresh();
    };
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
    };
  }, [refresh]);

  // Live push — Charles + the TS routes emit a 'audit' tick whenever any
  // audit-feed source mutates (a delegation runs, a draft is created, a
  // stage advances). The hook treats the first observed tick as baseline,
  // so this doesn't fire on mount.
  const onTick = useCallback(() => {
    void refresh();
  }, [refresh]);
  useOnRealtimeTick(spaceId, 'audit', onTick);

  const rows = useMemo(() => eventsToDockRows(events), [events]);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
      } catch {
        // Best-effort.
      }
      return next;
    });
  }

  function submit() {
    const v = value.trim();
    if (!v) {
      router.push(`/s/${slug}/chat`);
      return;
    }
    router.push(`/s/${slug}/chat?prompt=${encodeURIComponent(v)}`);
  }

  // Collapsed rail only exists on desktop. Mobile overlay never collapses —
  // the overlay's X button is how you dismiss it.
  if (collapsed && !isMobile) {
    return (
      <aside
        data-testid="chat-dock"
        data-collapsed="true"
        className="hidden h-full w-8 flex-col items-center border-l border-slate-200 bg-white py-2 md:flex"
      >
        <button
          type="button"
          aria-label="Expand chat dock"
          onClick={toggleCollapsed}
          className="flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-900"
        >
          <ChevronLeft size={14} />
        </button>
        <div className="mt-3 flex h-7 w-7 items-center justify-center text-slate-400">
          <MessageSquare size={14} />
        </div>
      </aside>
    );
  }

  return (
    <aside
      data-testid="chat-dock"
      data-collapsed="false"
      data-variant={variant}
      className={cn(
        'h-full flex-col bg-white',
        isMobile
          ? 'flex w-full'
          : 'hidden w-[420px] border-l border-slate-200 md:flex',
      )}
    >
      {/* Tabs */}
      <div className="flex h-10 items-stretch border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            data-testid={`chat-dock-tab-${t.toLowerCase()}`}
            className={cn(
              'flex-1 text-[12px] transition-colors',
              tab === t
                ? 'border-b-2 border-slate-900 font-semibold text-slate-900'
                : 'text-slate-500 hover:text-slate-900',
            )}
          >
            {t}
          </button>
        ))}
        {!isMobile && (
          <button
            type="button"
            aria-label="Collapse chat dock"
            onClick={toggleCollapsed}
            className="flex w-8 items-center justify-center border-l border-slate-200 text-slate-400 hover:text-slate-900"
          >
            <ChevronRight size={14} />
          </button>
        )}
      </div>

      {/* Thread */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {tab === 'Home' || tab === 'Charles' ? (
          <HomeFeed rows={rows} />
        ) : tab === 'Library' ? (
          <LibraryTab />
        ) : (
          <ComingSoon label={tab} />
        )}
      </div>

      {/* Input */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="border-t border-slate-200 p-3"
      >
        <div className="relative">
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Ask Charles to spin up new task agents…"
            className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-3 pr-10 text-[13px] text-slate-900 placeholder:text-slate-400 outline-none focus:border-slate-400"
          />
          <button
            type="submit"
            aria-label="Send to Charles"
            disabled={value.trim().length === 0}
            className="absolute right-1 top-1 inline-flex h-7 w-7 items-center justify-center rounded-md bg-slate-900 text-white disabled:opacity-30"
          >
            <ArrowRight size={14} />
          </button>
        </div>
      </form>
    </aside>
  );
}

function HomeFeed({ rows }: { rows: DockRow[] }) {
  if (rows.length === 0) {
    return (
      <div
        className="flex h-full flex-col items-center justify-center text-center"
        data-testid="chat-dock-empty"
      >
        <div className="text-[13px] text-slate-500">
          Nothing&rsquo;s happening right now. Press ⌘K to spin something up.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2" data-testid="chat-dock-feed">
      {rows.map((row) =>
        row.kind === 'subagent' ? (
          <div key={row.id} className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <SubagentChip
                department={row.department}
                agentName={row.agentName}
                task={row.task}
                status={row.status}
                duration={row.duration}
              />
            </div>
            <span className={cn(MONO_META, 'flex-shrink-0 text-slate-400')}>
              {timeAgo(row.occurredAt)}
            </span>
          </div>
        ) : (
          <div
            key={row.id}
            className="flex items-center gap-2 rounded-lg px-2 py-1.5"
            data-testid="chat-dock-text-row"
          >
            {row.department && (
              <Image
                src={iconForDepartment(row.department)}
                alt=""
                width={20}
                height={20}
                className="h-5 w-5 flex-shrink-0"
                aria-hidden
              />
            )}
            <div className="min-w-0 flex-1 truncate text-[12px] text-slate-700">
              {row.summary}
            </div>
            <span className={cn(MONO_META, 'flex-shrink-0 text-slate-400')}>
              {timeAgo(row.occurredAt)}
            </span>
          </div>
        ),
      )}
    </div>
  );
}

function ComingSoon({ label }: { label: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center text-center">
      <div className="text-[12px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-1 text-[13px] text-slate-500">Coming soon.</div>
    </div>
  );
}
