import { notFound, redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import {
  Activity,
  FileEdit,
  CheckCircle2,
  XCircle,
  PauseCircle,
  Plug,
  Unplug,
  ArrowRight,
  CircleCheck,
  CirclePlay,
  CircleX,
} from 'lucide-react';
import { getSpaceFromSlug } from '@/lib/space';
import { loadAuditFeed, type AuditEvent, type AuditEventType } from '@/lib/observability/audit-feed';
import { timeAgo } from '@/lib/formatting';
import {
  H1,
  TITLE_FONT,
  BODY,
  BODY_MUTED,
  META,
  PAGE_RHYTHM,
  READING_MAX,
} from '@/lib/typography';

/**
 * Audit log — one column, one row per consequential event. No tabs.
 * The page exists so the founder can ask one question — "what just
 * happened?" — and read the answer top-to-bottom in chronological order.
 */
export default async function AuditPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ type?: string; before?: string }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const { userId } = await auth();
  if (!userId) redirect('/login/realtor');

  const space = await getSpaceFromSlug(slug);
  if (!space) notFound();

  const type = parseTypeFilter(sp.type);
  const limit = 50;
  const events = await loadAuditFeed(space.id, {
    limit,
    beforeIso: sp.before,
    type,
  });

  const oldest = events.length > 0 ? events[events.length - 1].occurredAt : null;
  const canLoadMore = events.length === limit;

  const baseHref = `/s/${slug}/settings/audit`;
  const filterHref = (t?: string) => (t ? `${baseHref}?type=${t}` : baseHref);

  return (
    <div className={`${PAGE_RHYTHM} ${READING_MAX}`}>
      <header className="space-y-1.5">
        <p className={BODY_MUTED}>Settings.</p>
        <h1 className={H1} style={TITLE_FONT}>
          Audit log
        </h1>
        <p className={BODY_MUTED}>
          Every meaningful thing Charles has done in this workspace.
        </p>
      </header>

      <nav className="flex flex-wrap gap-2" aria-label="Filter audit events">
        {FILTER_GROUPS.map((g) => {
          const active =
            (g.value === undefined && !sp.type) ||
            (g.value !== undefined && g.value === sp.type);
          return (
            <a
              key={g.label}
              href={filterHref(g.value)}
              className={[
                'inline-flex items-center rounded-full border px-3 h-7 text-xs font-medium transition-colors',
                active
                  ? 'bg-foreground text-background border-foreground'
                  : 'border-border/60 text-muted-foreground hover:text-foreground hover:bg-foreground/[0.04]',
              ].join(' ')}
            >
              {g.label}
            </a>
          );
        })}
      </nav>

      {events.length === 0 ? (
        <p className={BODY_MUTED}>Nothing yet.</p>
      ) : (
        <ol className="divide-y divide-border/60 border-y border-border/60">
          {events.map((e) => (
            <AuditRow key={e.id} event={e} />
          ))}
        </ol>
      )}

      {canLoadMore && oldest && (
        <div className="pt-2">
          <a
            href={`${baseHref}?${new URLSearchParams({
              ...(sp.type ? { type: sp.type } : {}),
              before: oldest,
            }).toString()}`}
            className="text-sm text-muted-foreground hover:text-foreground underline underline-offset-2"
          >
            Load more
          </a>
        </div>
      )}
    </div>
  );
}

function AuditRow({ event }: { event: AuditEvent }) {
  const Icon = ICONS[event.type] ?? Activity;
  return (
    <li className="flex items-start gap-3 py-3">
      <Icon
        className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
        strokeWidth={1.75}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <p className={`${BODY} break-words`}>{event.summary}</p>
      </div>
      {event.department && (
        <span className="shrink-0 inline-flex items-center rounded-full border border-border/60 px-2 h-5 text-[11px] text-muted-foreground">
          {event.department}
        </span>
      )}
      <span className={`${META} shrink-0 whitespace-nowrap`}>{timeAgo(event.occurredAt)}</span>
    </li>
  );
}

const ICONS: Record<AuditEventType, typeof Activity> = {
  agent_run_started: CirclePlay,
  agent_run_completed: CircleCheck,
  agent_run_failed: CircleX,
  draft_created: FileEdit,
  draft_accepted: CheckCircle2,
  draft_declined: XCircle,
  paused_run_approved: PauseCircle,
  paused_run_declined: PauseCircle,
  integration_connected: Plug,
  integration_disconnected: Unplug,
  stage_advanced: ArrowRight,
  gate_completed: CheckCircle2,
};

const TYPE_GROUPS: Record<string, AuditEventType> = {
  runs: 'agent_run_completed',
  drafts: 'draft_created',
  approvals: 'paused_run_approved',
  integrations: 'integration_connected',
  stages: 'stage_advanced',
};

const FILTER_GROUPS: { label: string; value?: string }[] = [
  { label: 'All' },
  { label: 'Runs', value: 'agent_run_completed' },
  { label: 'Drafts', value: 'draft_created' },
  { label: 'Approvals', value: 'paused_run_approved' },
  { label: 'Integrations', value: 'integration_connected' },
  { label: 'Stages', value: 'stage_advanced' },
];

function parseTypeFilter(t?: string): AuditEventType | undefined {
  if (!t) return undefined;
  const allowed = new Set<AuditEventType>([
    'agent_run_started',
    'agent_run_completed',
    'agent_run_failed',
    'draft_created',
    'draft_accepted',
    'draft_declined',
    'paused_run_approved',
    'paused_run_declined',
    'integration_connected',
    'integration_disconnected',
    'stage_advanced',
    'gate_completed',
  ]);
  return allowed.has(t as AuditEventType) ? (t as AuditEventType) : undefined;
}

// `TYPE_GROUPS` is exported-via-use; keeping the lookup table near the
// filter buttons documents which event-types the chips actually narrow to.
void TYPE_GROUPS;
