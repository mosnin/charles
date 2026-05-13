/**
 * /s/[slug]/tasks — the shared to-do surface.
 *
 * One column. Open lives at the top. Recently done recedes underneath.
 * Cancelled hides by default. No status filter pills, no kanban — every
 * task either earns the open list or it doesn't.
 *
 * Server component owns the read. The row component owns mutation, with
 * optimistic toggles and a toast on error. New task goes through the form
 * client component.
 */

import { notFound, redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import { getSpaceFromSlug } from '@/lib/space';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import {
  H1,
  TITLE_FONT,
  BODY_MUTED,
  SECTION_LABEL,
  PAGE_RHYTHM,
  READING_MAX,
} from '@/lib/typography';
import type { Task, TaskStatus } from '@/lib/tasks/catalog';
import { NewTaskForm } from './new-task-form';
import { TaskRow } from './task-row';

const PRIORITY_RANK: Record<Task['priority'], number> = {
  high: 0,
  normal: 1,
  low: 2,
};

function sortOpen(a: Task, b: Task): number {
  const p = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
  if (p !== 0) return p;
  if (a.dueAt && b.dueAt) {
    const d = new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();
    if (d !== 0) return d;
  } else if (a.dueAt && !b.dueAt) return -1;
  else if (!a.dueAt && b.dueAt) return 1;
  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
}

function sortRecent(a: Task, b: Task): number {
  const aTime = new Date(a.completedAt ?? a.updatedAt).getTime();
  const bTime = new Date(b.completedAt ?? b.updatedAt).getTime();
  return bTime - aTime;
}

export default async function TasksPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { userId } = await auth();
  if (!userId) redirect('/login/realtor');

  const space = await getSpaceFromSlug(slug);
  if (!space) notFound();

  // Ownership gate — same pattern as /inbox.
  const { data: spaceOwner } = await supabase
    .from('User')
    .select('id')
    .eq('clerkId', userId)
    .eq('id', space.ownerId)
    .maybeSingle();
  if (!spaceOwner) notFound();

  const { data, error } = await supabase
    .from('Task')
    .select(
      'id, spaceId, title, description, status, priority, assigneeKind, assigneeDept, createdBy, createdByDept, dueAt, completedAt, createdAt, updatedAt',
    )
    .eq('spaceId', space.id);

  const tasks: Task[] = error ? [] : ((data ?? []) as Task[]);

  const open = tasks.filter((t) => t.status === 'open' || t.status === 'in_progress').sort(sortOpen);
  const done = tasks.filter((t) => t.status === 'done').sort(sortRecent).slice(0, 10);
  const cancelled = tasks.filter((t) => t.status === 'cancelled').sort(sortRecent);

  return (
    <div className={cn(PAGE_RHYTHM, READING_MAX)}>
      {/* Header */}
      <header className="flex items-start justify-between gap-6">
        <div className="space-y-1.5">
          <p className={BODY_MUTED}>Tasks.</p>
          <h1 className={H1} style={TITLE_FONT}>
            Tasks
          </h1>
          <p className={BODY_MUTED}>
            What you and Charles are working on. Open at the top, done at the bottom.
          </p>
        </div>
        <NewTaskForm />
      </header>

      {/* Open */}
      <section className="space-y-3">
        <p className={SECTION_LABEL}>
          {open.length > 0 ? `Open — ${open.length}` : 'Open'}
        </p>
        {open.length === 0 ? (
          <EmptyOpen />
        ) : (
          <ul>
            {open.map((task) => (
              <TaskRow key={task.id} task={task} />
            ))}
          </ul>
        )}
      </section>

      {/* Recently done */}
      {done.length > 0 && (
        <section className="space-y-3">
          <p className={SECTION_LABEL}>Recently done</p>
          <ul>
            {done.map((task) => (
              <TaskRow key={task.id} task={task} muted />
            ))}
          </ul>
        </section>
      )}

      {/* Cancelled — collapsed */}
      {cancelled.length > 0 && (
        <details className="space-y-3 group">
          <summary
            className={cn(
              SECTION_LABEL,
              'cursor-pointer select-none hover:text-foreground transition-colors',
            )}
          >
            Cancelled — {cancelled.length}
          </summary>
          <ul className="mt-3">
            {cancelled.map((task) => (
              <TaskRow key={task.id} task={task} muted />
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function EmptyOpen() {
  return (
    <div className="rounded-xl border border-dashed border-border/70 bg-muted/20 px-5 py-10 text-center">
      <p className="text-sm text-foreground">Nothing on the list.</p>
      <p className={cn(BODY_MUTED, 'mt-1.5')}>
        Add one with the button above, or ask Charles to spin it up.
      </p>
    </div>
  );
}

// Re-export the status type so server-only tooling can import without
// pulling the catalog through two paths.
export type { TaskStatus };
