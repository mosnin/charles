import { notFound, redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import { getSpaceFromSlug } from '@/lib/space';
import { supabase } from '@/lib/supabase';
import { timeAgo } from '@/lib/formatting';
import {
  H1,
  TITLE_FONT,
  BODY,
  BODY_MUTED,
  CAPTION,
  META,
  PAGE_RHYTHM,
  READING_MAX,
} from '@/lib/typography';

interface RunMember {
  id: string;
  name: string;
  role: string | null;
  task: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  output: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  swarmRunId: string;
  goal: string | null;
}

/**
 * Agent runs — one table, one row per SwarmMember invocation. Click a row
 * to expand the full task + output. No client component needed for this:
 * `<details>` does the work natively, no flicker, no hydration.
 */
export default async function RunsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { userId } = await auth();
  if (!userId) redirect('/sign-in');

  const space = await getSpaceFromSlug(slug);
  if (!space) notFound();

  const members = await loadRecentMembers(space.id, 50);

  const counts = {
    completed: members.filter((m) => m.status === 'completed').length,
    failed: members.filter((m) => m.status === 'failed').length,
    running: members.filter((m) => m.status === 'running' || m.status === 'queued').length,
  };

  return (
    <div className={`${PAGE_RHYTHM} ${READING_MAX}`}>
      <header className="space-y-1.5">
        <p className={BODY_MUTED}>Settings.</p>
        <h1 className={H1} style={TITLE_FONT}>
          Agent runs
        </h1>
        <p className={BODY_MUTED}>
          Every department invocation, what it tried, what happened.
        </p>
      </header>

      <p className={CAPTION}>
        {counts.completed} completed · {counts.failed} failed · {counts.running} running
      </p>

      {members.length === 0 ? (
        <p className={BODY_MUTED}>No runs yet.</p>
      ) : (
        <ul className="divide-y divide-border/60 border-y border-border/60">
          {members.map((m) => (
            <RunRow key={m.id} member={m} />
          ))}
        </ul>
      )}
    </div>
  );
}

function RunRow({ member }: { member: RunMember }) {
  const duration = durationLabel(member.startedAt, member.completedAt);
  const when = member.completedAt ?? member.startedAt ?? member.createdAt;
  const status = member.status;

  return (
    <li>
      <details className="group py-3">
        <summary className="flex items-center gap-3 cursor-pointer list-none">
          <span className="min-w-0 flex-1 flex items-baseline gap-3">
            <span className={`${BODY} font-medium shrink-0`}>{member.role ?? member.name}</span>
            <span className={`${BODY_MUTED} truncate`}>{truncate(member.task, 90)}</span>
          </span>
          <StatusPill status={status} />
          <span className={`${META} shrink-0 w-12 text-right`}>{duration}</span>
          <span className={`${META} shrink-0 whitespace-nowrap`}>{timeAgo(when)}</span>
        </summary>
        <div className="mt-3 ml-0 space-y-3 border-l border-border/60 pl-4">
          {member.goal && (
            <Field label="Swarm goal" value={member.goal} />
          )}
          <Field label="Task" value={member.task} />
          {member.output && status === 'completed' && (
            <Field label="Output" value={member.output} />
          )}
          {member.output && status === 'failed' && (
            <Field label="Error" value={member.output} />
          )}
          {!member.output && status === 'failed' && (
            <Field label="Error" value="No error message recorded." />
          )}
        </div>
      </details>
    </li>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <p className={CAPTION}>{label}</p>
      <p className={`${BODY} whitespace-pre-wrap break-words`}>{value}</p>
    </div>
  );
}

function StatusPill({ status }: { status: RunMember['status'] }) {
  const style =
    status === 'completed'
      ? 'border-[color:#1F6E3A]/30 text-[color:#1F6E3A]'
      : status === 'failed'
        ? 'border-[color:#8B1A1A]/30 text-[color:#8B1A1A]'
        : 'border-border/60 text-muted-foreground';
  return (
    <span
      className={`shrink-0 inline-flex items-center rounded-full border px-2 h-5 text-[11px] ${style}`}
    >
      {status}
    </span>
  );
}

function truncate(s: string, n: number): string {
  if (!s) return '';
  return s.length <= n ? s : s.slice(0, n).trimEnd() + '…';
}

function durationLabel(startedAt: string | null, completedAt: string | null): string {
  if (!startedAt) return '—';
  const end = completedAt ? new Date(completedAt).getTime() : Date.now();
  const start = new Date(startedAt).getTime();
  const ms = Math.max(0, end - start);
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r === 0 ? `${m}m` : `${m}m${r}s`;
}

async function loadRecentMembers(spaceId: string, limit: number): Promise<RunMember[]> {
  try {
    const { data, error } = await supabase
      .from('SwarmMember')
      .select(
        'id, name, role, task, status, output, startedAt, completedAt, createdAt, swarmRunId, swarmRun:SwarmRun!inner(spaceId, goal)',
      )
      .eq('swarmRun.spaceId', spaceId)
      .order('createdAt', { ascending: false })
      .limit(limit);
    if (error) throw error;
    const rows = (data ?? []) as Array<
      Omit<RunMember, 'goal'> & { swarmRun?: { goal?: string | null } | { goal?: string | null }[] }
    >;
    return rows.map((r) => {
      const sr = Array.isArray(r.swarmRun) ? r.swarmRun[0] : r.swarmRun;
      return {
        id: r.id,
        name: r.name,
        role: r.role,
        task: r.task,
        status: r.status,
        output: r.output,
        startedAt: r.startedAt,
        completedAt: r.completedAt,
        createdAt: r.createdAt,
        swarmRunId: r.swarmRunId,
        goal: sr?.goal ?? null,
      };
    });
  } catch (err) {
    console.warn('[runs] failed to load swarm members', err);
    return [];
  }
}
