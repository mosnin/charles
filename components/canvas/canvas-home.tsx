'use client';

/**
 * CanvasHome — the marquee surface of Charles.
 *
 * Desktop (md+): the mission at the heart of an orbit; six departments
 * around it; the chat dock on the right. The founder pans and zooms the
 * canvas with the mouse; the chrome stays fixed.
 *
 * Mobile (< md): the orbit doesn't fit and panning a 375px viewport isn't
 * navigation. We stack — sapling + workspace name at the top, the six dept
 * cards in a 2-column grid below, and a floating "Chat with Charles"
 * button that opens the dock as a full-screen overlay.
 *
 * Responsive contract:
 *   - Tailwind `md:` breakpoint (768px) is the cut.
 *   - Desktop layout: `hidden md:flex` on the orbital section + dock.
 *   - Mobile layout:  `flex md:hidden` on the stacked section.
 *   - The chat dock on mobile is a full-screen overlay anchored to a FAB.
 *   - No SVG connectors on mobile — they only make sense in the orbit.
 *
 * The pan/zoom is a single transform on the canvas inner layer — no deps,
 * no physics, no spring. `scale` is clamped 0.5–1.5; `translate` is free.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { FolderOpen, MessageSquare, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AutonomyLevel, DepartmentSlug } from '@/lib/departments/autonomy';
import { DEPARTMENT_NAMES } from '@/lib/departments/autonomy';
import { iconForDepartment } from '@/lib/icons/manifest';
import { MONO_CHIP } from '@/lib/typography';
import { GridBackground } from './grid-background';
import { CenterPiece } from './center-piece';
import { DeptNode } from './dept-node';
import { ChatDock } from './chat-dock';
import { Sapling } from './sapling';
import { StatusDot } from './status-dot';
import { ORBIT_ORDER, orbitPoint } from '@/lib/canvas/orbit';
import type { DeptCounts } from '@/lib/canvas/dept-counts';
import type { MessageBlock } from '@/lib/ai-tools/blocks';
import type { DailyBriefingData } from '@/lib/briefing/build-daily-briefing';
import { subscribeToDeptActivity } from '@/lib/canvas/realtime';
import { useCanvasActivity } from '@/lib/convex/use-canvas-activity';
import { usePresence } from '@/lib/convex/use-presence';
import { LiveCursorsOverlay } from './live-cursors-overlay';

export interface CanvasHomeProps {
  slug: string;
  /** Space id — required for presence subscriptions on this surface. */
  spaceId: string;
  workspaceName: string;
  missionTitle: string;
  autonomyBySlug: Record<DepartmentSlug, AutonomyLevel>;
  githubRepo: string | null;
  /** Per-dept running/queued/idle counts. All six depts present. */
  deptCounts: Record<DepartmentSlug, DeptCounts>;
  /** Most-recent conversation id for the dock's hydrated transcript. */
  initialConversationId: string | null;
  /** Messages for `initialConversationId`, in chronological order. */
  initialMessages: { role: 'user' | 'assistant'; content: string; blocks?: MessageBlock[] | null }[];
  /** Daily briefing snapshot — null if it couldn't be built. Charles
   *  speaks this as his first message of the day inside the dock. */
  briefing: DailyBriefingData | null;
  /** Plan currently in flight (status in planning/running/auditing),
   *  null when nothing's active. The dock surfaces this as a pill at
   *  the top of the transcript, linking through to the live Plan View. */
  activePlan: {
    id: string;
    goal: string;
    totalSteps: number;
    completedSteps: number;
  } | null;
  /** Server-fetched count of pending approvals for this space. */
  pendingApprovalsCount: number;
}

const ORBIT_RADIUS = 220;
const NODE_W = 120;
const NODE_H = 60;
const CENTER_W = 180;
const CENTER_H = 100;

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 1.5;

export function CanvasHome({
  slug,
  spaceId,
  workspaceName,
  missionTitle,
  autonomyBySlug,
  githubRepo,
  deptCounts,
  initialConversationId,
  initialMessages,
  briefing,
  activePlan,
  pendingApprovalsCount,
}: CanvasHomeProps) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [mobileChatOpen, setMobileChatOpen] = useState(false);
  const [liveDeptCounts, setLiveDeptCounts] = useState(deptCounts);
  const canvasRootRef = useRef<HTMLDivElement | null>(null);

  // Live cursors on canvas-home. Deferred in Wave 2A — now wired. Cursor
  // coordinates from the heartbeat hook feed into LiveCursorsOverlay, which
  // sits absolutely above the orbit and beneath the top-left/right chrome.
  const presentOnCanvas = usePresence({ spaceId, withCursor: true });

  // Live activity layer from Convex. Empty array when Convex is
  // unavailable — the server-loaded `liveDeptCounts` then stays as the
  // source of truth and no ripple plays.
  const activity = useCanvasActivity(slug);

  // Derive (a) the most recent activity row id per dept (the ripple key)
  // and (b) overridden running / queued counts when the live layer is on.
  const { activityKeyByDept, overrideCounts } = useMemo(() => {
    const keys = {} as Record<DepartmentSlug, string | undefined>;
    const counts = {} as Record<DepartmentSlug, { running: number; queued: number } | undefined>;
    if (activity.length === 0) return { activityKeyByDept: keys, overrideCounts: counts };

    // First (top) row is most recent given the Convex query's sort.
    for (const row of activity) {
      const dept = row.department as DepartmentSlug;
      if (!keys[dept]) keys[dept] = row.id;
      const c = counts[dept] ?? { running: 0, queued: 0 };
      if (row.kind === 'running') c.running += 1;
      else if (row.kind === 'queued') c.queued += 1;
      counts[dept] = c;
    }
    return { activityKeyByDept: keys, overrideCounts: counts };
  }, [activity]);

  function countsFor(deptSlug: DepartmentSlug): {
    running: number;
    queued: number;
    idle: number;
  } {
    const server = liveDeptCounts[deptSlug];
    const override = overrideCounts[deptSlug];
    if (!override) {
      return {
        running: server?.running ?? 0,
        queued: server?.queued ?? 0,
        idle: server?.idle ?? 1,
      };
    }
    const running = override.running;
    const queued = override.queued;
    return { running, queued, idle: running + queued > 0 ? 0 : 1 };
  }
  const dragRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(
    null,
  );

  const refreshDeptCounts = useCallback(async () => {
    try {
      const res = await fetch(`/api/space/${slug}/dept-counts`, { cache: 'no-store' });
      if (!res.ok) return;
      const data = (await res.json()) as Record<DepartmentSlug, DeptCounts>;
      if (data && typeof data === 'object') setLiveDeptCounts(data);
    } catch {
      // Network blip — next tick will catch up.
    }
  }, [slug]);

  // Realtime subscriptions + polling fallback. The unsubscribe is a no-op
  // if the browser client couldn't initialize, in which case polling alone
  // keeps things fresh.
  useEffect(() => {
    const unsubDept = subscribeToDeptActivity(slug, () => {
      void refreshDeptCounts();
    });
    const pollId = window.setInterval(() => {
      void refreshDeptCounts();
    }, 30_000);
    return () => {
      unsubDept();
      window.clearInterval(pollId);
    };
  }, [slug, refreshDeptCounts]);

  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    // Only left-button drags pan the canvas.
    if (e.button !== 0) return;
    // Don't hijack clicks on interactive children — links, buttons, inputs.
    const target = e.target as HTMLElement;
    if (target.closest('a, button, input, textarea, [data-no-pan]')) return;
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      baseX: pan.x,
      baseY: pan.y,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, [pan]);

  const onPointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    setPan({ x: d.baseX + (e.clientX - d.startX), y: d.baseY + (e.clientY - d.startY) });
  }, []);

  const onPointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    dragRef.current = null;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // pointer was never captured — fine.
    }
  }, []);

  const onWheel = useCallback((e: ReactWheelEvent<HTMLDivElement>) => {
    // Trackpad pinch shows up as ctrl+wheel — treat that as zoom.
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const delta = -e.deltaY * 0.002;
    setZoom((z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z + delta)));
  }, []);

  // Six dept node placements, computed once per radius.
  const placements = useMemo(
    () =>
      ORBIT_ORDER.map((deptSlug, i) => ({
        deptSlug,
        ...orbitPoint(i, ORBIT_ORDER.length, ORBIT_RADIUS),
      })),
    [],
  );

  const zoomPct = Math.round(zoom * 100);

  return (
    <div className="flex h-full w-full overflow-hidden bg-white">
      {/* ─── Desktop (md+): orbital canvas + right-docked chat ─────────── */}
      <section
        ref={canvasRootRef}
        className="relative hidden flex-1 overflow-hidden select-none md:block"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
        style={{ cursor: dragRef.current ? 'grabbing' : 'grab' }}
        data-testid="canvas-surface"
      >
        <GridBackground />

        {/* Live cursors — z-10 sits above grid + orbit (default z-0) but
            below the top-left/right chrome (z-20) and modals (z-30+).
            Cursors filter to users currently on this surface only. */}
        <LiveCursorsOverlay
          otherUsers={presentOnCanvas}
          containerRef={canvasRootRef}
          surfaceKey={`/s/${slug}`}
        />

        {/* Top-left badge (fixed, not transformed) */}
        <div className="pointer-events-auto absolute left-4 top-4 z-20 flex flex-col items-start gap-1.5" data-no-pan>
          <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-white pl-1 pr-3 py-1">
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-[11px] font-semibold text-white">
              {initials(workspaceName)}
            </span>
            <span
              className="max-w-[180px] truncate text-[13px] font-medium text-slate-900"
              data-testid="workspace-name"
            >
              {workspaceName}
            </span>
          </div>
          <span
            className={cn(
              MONO_CHIP,
              'inline-flex items-center rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-slate-500',
            )}
            data-testid="zoom-chip"
          >
            Z {zoomPct}%
          </span>
        </div>

        {/* Top-right controls (fixed) */}
        <div className="pointer-events-auto absolute right-4 top-4 z-20 flex items-center gap-1" data-no-pan>
          <IconBtn label="Open folder">
            <FolderOpen size={14} />
          </IconBtn>
          <IconBtn label="Search">
            <Search size={14} />
          </IconBtn>
        </div>

        {/* Repo chip (bottom-left, fixed) */}
        {githubRepo && (
          <div
            className="pointer-events-auto absolute bottom-3 left-4 z-20"
            data-no-pan
            data-testid="repo-chip"
          >
            <span className="font-mono text-[10px] text-slate-400">{githubRepo}</span>
          </div>
        )}

        {/* Pannable / zoomable layer */}
        <div
          className="absolute inset-0"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: 'center center',
            transition: dragRef.current ? 'none' : 'transform 120ms cubic-bezier(0.2, 0.8, 0.2, 1)',
          }}
        >
          <div className="relative h-full w-full">
            {/* The orbit anchor — dead center of the surface. Everything below
                positions itself relative to this point. */}
            <div className="absolute left-1/2 top-1/2">
              {/* Dashed orbit ring */}
              <div
                aria-hidden
                className="absolute rounded-full border border-dashed border-slate-300"
                style={{
                  width: ORBIT_RADIUS * 2,
                  height: ORBIT_RADIUS * 2,
                  left: -ORBIT_RADIUS,
                  top: -ORBIT_RADIUS,
                }}
                data-testid="orbit-ring"
              />

              {/* Connector lines: SVG underlay, centered on the anchor. */}
              <svg
                aria-hidden
                width={ORBIT_RADIUS * 2 + 80}
                height={ORBIT_RADIUS * 2 + 80}
                viewBox={`${-(ORBIT_RADIUS + 40)} ${-(ORBIT_RADIUS + 40)} ${ORBIT_RADIUS * 2 + 80} ${ORBIT_RADIUS * 2 + 80}`}
                className="absolute pointer-events-none"
                style={{
                  left: -(ORBIT_RADIUS + 40),
                  top: -(ORBIT_RADIUS + 40),
                }}
              >
                {placements.map((p) => (
                  <line
                    key={p.deptSlug}
                    x1={0}
                    y1={0}
                    x2={p.x}
                    y2={p.y}
                    stroke="rgb(203 213 225)"
                    strokeWidth={1}
                    strokeDasharray="3 3"
                  />
                ))}
              </svg>

              {/* Centerpiece */}
              <div
                className="absolute"
                style={{
                  left: -CENTER_W / 2,
                  top: -CENTER_H / 2,
                  width: CENTER_W,
                }}
              >
                <CenterPiece title={missionTitle} />
              </div>

              {/* Dept nodes */}
              {placements.map((p) => {
                const c = countsFor(p.deptSlug);
                return (
                  <div
                    key={p.deptSlug}
                    className="absolute"
                    style={{
                      left: p.x - NODE_W / 2,
                      top: p.y - NODE_H / 2,
                    }}
                  >
                    <DeptNode
                      spaceSlug={slug}
                      deptSlug={p.deptSlug}
                      name={DEPARTMENT_NAMES[p.deptSlug]}
                      autonomyLevel={autonomyBySlug[p.deptSlug]}
                      runningCount={c.running}
                      queuedCount={c.queued}
                      idleCount={c.idle}
                      activityKey={activityKeyByDept[p.deptSlug]}
                    />
                  </div>
                );
              })}

              {/* Empty placeholder slots — corners around the canvas */}
              {PLACEHOLDER_OFFSETS.map((p, i) => (
                <div
                  key={i}
                  aria-hidden
                  className="absolute rounded-xl border border-dashed border-slate-200"
                  style={{
                    left: p.x - 75,
                    top: p.y - 40,
                    width: 150,
                    height: 80,
                  }}
                  data-testid="placeholder-slot"
                />
              ))}
            </div>
          </div>
        </div>

      </section>

      {/* Desktop chat dock — hidden on mobile via its own md: classes.
          The dock is the command center: it holds the conversation, the
          approvals badge, the active-plan pill, and the daily briefing
          (Charles speaks the briefing as his first message of the day). */}
      <ChatDock
        slug={slug}
        initialConversationId={initialConversationId}
        initialMessages={initialMessages}
        initialPendingApprovalsCount={pendingApprovalsCount}
        activePlan={activePlan}
        briefing={briefing}
      />

      {/* ─── Mobile (< md): vertical stack ─────────────────────────────── */}
      <section
        className="relative flex-1 overflow-y-auto md:hidden"
        data-testid="canvas-mobile"
      >
        <GridBackground />

        <div className="relative z-10 flex flex-col gap-6 px-5 pt-6 pb-28">
          {/* Workspace name + sapling row */}
          <div className="flex flex-col items-center gap-2 text-center">
            <Sapling size={40} />
            <h1
              className="max-w-[260px] truncate text-[20px] font-semibold text-slate-900"
              data-testid="canvas-mobile-title"
            >
              {workspaceName}
            </h1>
          </div>

          {/* 6 dept cards — 2-column grid */}
          <div className="grid grid-cols-2 gap-3" data-testid="canvas-mobile-grid">
            {ORBIT_ORDER.map((deptSlug) => {
              const c = countsFor(deptSlug);
              return (
                <MobileDeptCard
                  key={deptSlug}
                  spaceSlug={slug}
                  deptSlug={deptSlug}
                  name={DEPARTMENT_NAMES[deptSlug]}
                  autonomyLevel={autonomyBySlug[deptSlug]}
                  runningCount={c.running}
                  queuedCount={c.queued}
                  idleCount={c.idle}
                  activityKey={activityKeyByDept[deptSlug]}
                />
              );
            })}
          </div>

          {githubRepo && (
            <div className="text-center">
              <span className="font-mono text-[10px] text-slate-400">{githubRepo}</span>
            </div>
          )}
        </div>

        {/* Floating chat FAB (mobile only) */}
        <button
          type="button"
          onClick={() => setMobileChatOpen(true)}
          className="fixed bottom-5 right-5 z-30 inline-flex h-12 items-center gap-2 rounded-full bg-slate-900 px-4 text-[13px] font-medium text-white shadow-none active:bg-slate-800 md:hidden"
          data-testid="mobile-chat-fab"
          aria-label="Chat with Charles"
        >
          <MessageSquare size={16} />
          <span>Chat with Charles</span>
        </button>

        {/* Full-screen chat overlay */}
        {mobileChatOpen && (
          <div
            className="fixed inset-0 z-40 flex flex-col bg-white md:hidden"
            data-testid="mobile-chat-overlay"
            role="dialog"
            aria-modal="true"
            aria-label="Chat with Charles"
          >
            <div className="flex h-12 items-center justify-between border-b border-slate-200 px-3">
              <span className="text-[13px] font-medium text-slate-900">Charles</span>
              <button
                type="button"
                onClick={() => setMobileChatOpen(false)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-md text-slate-500 active:text-slate-900"
                aria-label="Close chat"
                data-testid="mobile-chat-close"
              >
                <X size={18} />
              </button>
            </div>
            <div className="flex-1 min-h-0">
              <ChatDock
                slug={slug}
                initialConversationId={initialConversationId}
                initialMessages={initialMessages}
                initialPendingApprovalsCount={pendingApprovalsCount}
                activePlan={activePlan}
                briefing={briefing}
                variant="mobile"
              />
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

const PLACEHOLDER_OFFSETS = [
  { x: -ORBIT_RADIUS - 200, y: -ORBIT_RADIUS - 60 },
  { x: ORBIT_RADIUS + 200, y: -ORBIT_RADIUS - 60 },
  { x: -ORBIT_RADIUS - 240, y: 0 },
  { x: ORBIT_RADIUS + 240, y: 0 },
  { x: -ORBIT_RADIUS - 200, y: ORBIT_RADIUS + 60 },
  { x: ORBIT_RADIUS + 200, y: ORBIT_RADIUS + 60 },
];

function IconBtn({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title="Coming soon"
      className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 hover:text-slate-900"
    >
      {children}
    </button>
  );
}

/**
 * MobileDeptCard — wider, shorter alternative to DeptNode for the 2-col grid.
 *
 * Same data, calmer layout — the orbital DeptNode squeezes counts into 120px;
 * here we have ~160px+ per cell so the icon can breathe and the counts read.
 */
function MobileDeptCard({
  spaceSlug,
  deptSlug,
  name,
  autonomyLevel,
  runningCount,
  queuedCount,
  idleCount,
  activityKey,
}: {
  spaceSlug: string;
  deptSlug: DepartmentSlug;
  name: string;
  autonomyLevel: AutonomyLevel;
  runningCount: number;
  queuedCount: number;
  idleCount: number;
  activityKey?: string;
}) {
  const [pulsing, setPulsing] = useState(false);
  useEffect(() => {
    if (!activityKey) return;
    setPulsing(true);
    const id = window.setTimeout(() => setPulsing(false), 1500);
    return () => window.clearTimeout(id);
  }, [activityKey]);

  return (
    <Link
      href={`/s/${spaceSlug}/d/${deptSlug}`}
      data-testid={`dept-node-mobile-${deptSlug}`}
      data-autonomy={autonomyLevel}
      data-pulsing={pulsing ? 'true' : undefined}
      className={cn(
        'flex flex-col gap-2 rounded-xl border border-slate-200 bg-white px-3 py-3 active:border-slate-400',
        pulsing && 'dept-pulse',
      )}
    >
      <div className="flex items-center gap-2">
        <Image
          src={iconForDepartment(deptSlug)}
          alt=""
          width={24}
          height={24}
          className="h-6 w-6 flex-shrink-0"
          aria-hidden
        />
        <span className="truncate text-[13px] font-medium text-slate-900">{name}</span>
      </div>
      <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
        {runningCount > 0 ? (
          <span className="inline-flex items-center gap-1">
            <StatusDot tone="running" />
            <span className="font-mono tabular-nums">{runningCount}</span>
          </span>
        ) : (
          <StatusDot tone="idle" />
        )}
        {queuedCount > 0 && (
          <span className="inline-flex items-center gap-1">
            <StatusDot tone="queued" />
            <span className="font-mono tabular-nums">{queuedCount}</span>
          </span>
        )}
        <span className="ml-auto font-mono text-[10px] tabular-nums text-slate-400">
          {idleCount}
        </span>
      </div>
    </Link>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '·';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
