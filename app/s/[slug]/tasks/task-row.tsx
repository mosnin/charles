'use client';

/**
 * A single task row. One line. Priority dot + title + assignee chip +
 * due date + kebab menu. Click the dot to toggle done. The menu owns the
 * harder actions: priority, status, delete.
 *
 * Mutations: optimistic with router.refresh() on success, toast on error.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Check, MoreHorizontal, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  DEPARTMENT_LABELS,
  STATUS_LABELS,
  type Task,
  type TaskPriority,
  type TaskStatus,
} from '@/lib/tasks/catalog';

interface TaskRowProps {
  task: Task;
  muted?: boolean;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function relativeDue(iso: string): string {
  const due = new Date(iso).getTime();
  const now = Date.now();
  const diffMs = due - now;
  const dayMs = 24 * 60 * 60 * 1000;
  const days = Math.round(diffMs / dayMs);
  if (Math.abs(diffMs) < 60 * 60 * 1000) return diffMs < 0 ? 'overdue' : 'due now';
  if (days === 0) return diffMs < 0 ? 'due earlier today' : 'due today';
  if (days === 1) return 'due tomorrow';
  if (days === -1) return 'due yesterday';
  if (days > 0 && days < 7) return `due in ${days}d`;
  if (days < 0 && days > -7) return `${Math.abs(days)}d overdue`;
  return `due ${new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
}

function priorityDotClass(p: TaskPriority): string {
  if (p === 'high') return 'bg-red-500/85';
  if (p === 'normal') return 'bg-amber-500/70';
  return 'bg-muted-foreground/40';
}

function assigneeLabel(task: Task): string {
  if (task.assigneeKind === 'founder') return 'You';
  if (task.assigneeKind === 'unassigned') return 'Unassigned';
  if (task.assigneeDept) return DEPARTMENT_LABELS[task.assigneeDept];
  return 'Agent';
}

export function TaskRow({ task, muted }: TaskRowProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [menuOpen, setMenuOpen] = useState(false);
  const [optimisticStatus, setOptimisticStatus] = useState<TaskStatus | null>(null);

  const status = optimisticStatus ?? task.status;
  const isDone = status === 'done' || status === 'cancelled';

  async function patch(payload: Record<string, unknown>) {
    const res = await fetch(`/api/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      toast.error(body.error ?? 'Could not update the task.');
      setOptimisticStatus(null);
      return false;
    }
    return true;
  }

  function toggleDone() {
    if (isPending) return;
    const next: TaskStatus = task.status === 'done' ? 'open' : 'done';
    setOptimisticStatus(next);
    startTransition(async () => {
      const ok = await patch({ status: next });
      if (ok) router.refresh();
    });
  }

  function changeStatus(next: TaskStatus) {
    setMenuOpen(false);
    if (isPending || next === task.status) return;
    setOptimisticStatus(next);
    startTransition(async () => {
      const ok = await patch({ status: next });
      if (ok) router.refresh();
    });
  }

  function changePriority(next: TaskPriority) {
    setMenuOpen(false);
    if (isPending || next === task.priority) return;
    startTransition(async () => {
      const ok = await patch({ priority: next });
      if (ok) router.refresh();
    });
  }

  function deleteTask() {
    setMenuOpen(false);
    if (isPending) return;
    if (!confirm(`Delete "${task.title}"?`)) return;
    startTransition(async () => {
      const res = await fetch(`/api/tasks/${task.id}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 204) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(body.error ?? 'Could not delete the task.');
        return;
      }
      router.refresh();
    });
  }

  return (
    <li
      className={cn(
        'group flex items-center gap-3 py-2.5 border-b border-border/40 last:border-b-0',
        isPending && 'opacity-60',
      )}
    >
      {/* Priority dot / completion toggle */}
      <button
        type="button"
        onClick={toggleDone}
        disabled={isPending}
        aria-label={isDone ? 'Reopen task' : 'Mark task as done'}
        className={cn(
          'flex-shrink-0 inline-flex items-center justify-center',
          'h-5 w-5 rounded-full border transition-colors duration-150',
          isDone
            ? 'border-foreground/30 bg-foreground/10 text-foreground'
            : 'border-transparent hover:border-foreground/40',
        )}
      >
        {isDone ? (
          <Check size={12} strokeWidth={2.5} />
        ) : (
          <span className={cn('h-2 w-2 rounded-full', priorityDotClass(task.priority))} />
        )}
      </button>

      {/* Title + due */}
      <div className="min-w-0 flex-1 flex items-center gap-3">
        <p
          className={cn(
            'text-sm leading-snug truncate',
            isDone || muted
              ? 'text-muted-foreground line-through decoration-muted-foreground/40'
              : 'text-foreground',
          )}
          title={task.title}
        >
          {task.title}
        </p>
        {task.dueAt && !isDone && (
          <span className="text-[11px] tabular-nums text-muted-foreground flex-shrink-0">
            {relativeDue(task.dueAt)}
          </span>
        )}
        {isDone && task.completedAt && (
          <span className="text-[11px] tabular-nums text-muted-foreground/70 flex-shrink-0">
            {relativeTime(task.completedAt)}
          </span>
        )}
      </div>

      {/* Assignee chip */}
      <span
        className={cn(
          'flex-shrink-0 inline-flex items-center rounded-full px-2 py-0.5',
          'text-[11px] font-medium',
          task.assigneeKind === 'unassigned'
            ? 'text-muted-foreground bg-muted/40'
            : 'text-foreground/80 bg-foreground/[0.04]',
        )}
      >
        {assigneeLabel(task)}
      </span>

      {/* Kebab */}
      <div className="relative flex-shrink-0">
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          aria-label="Task actions"
          className={cn(
            'inline-flex items-center justify-center h-7 w-7 rounded-md',
            'text-muted-foreground hover:text-foreground hover:bg-foreground/[0.04]',
            'transition-colors duration-150',
            'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
            menuOpen && 'opacity-100 text-foreground',
          )}
        >
          <MoreHorizontal size={14} />
        </button>
        {menuOpen && (
          <>
            <button
              type="button"
              aria-label="Close menu"
              className="fixed inset-0 z-10 cursor-default"
              onClick={() => setMenuOpen(false)}
            />
            <div
              className={cn(
                'absolute right-0 top-8 z-20 min-w-[180px]',
                'rounded-md border border-border bg-background py-1',
              )}
              role="menu"
            >
              <div className="px-2 py-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Status
              </div>
              {(['open', 'in_progress', 'done', 'cancelled'] as TaskStatus[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => changeStatus(s)}
                  className={cn(
                    'block w-full text-left px-3 py-1.5 text-sm',
                    'hover:bg-foreground/[0.04] transition-colors',
                    s === task.status && 'text-muted-foreground',
                  )}
                >
                  {STATUS_LABELS[s]}
                </button>
              ))}
              <div className="my-1 h-px bg-border" />
              <div className="px-2 py-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Priority
              </div>
              {(['high', 'normal', 'low'] as TaskPriority[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => changePriority(p)}
                  className={cn(
                    'block w-full text-left px-3 py-1.5 text-sm',
                    'hover:bg-foreground/[0.04] transition-colors',
                    p === task.priority && 'text-muted-foreground',
                  )}
                >
                  {p === 'high' ? 'High' : p === 'normal' ? 'Normal' : 'Low'}
                </button>
              ))}
              <div className="my-1 h-px bg-border" />
              <button
                type="button"
                onClick={deleteTask}
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-1.5 text-sm text-left',
                  'text-destructive hover:bg-destructive/[0.06] transition-colors',
                )}
              >
                <Trash2 size={13} />
                Delete
              </button>
            </div>
          </>
        )}
      </div>
    </li>
  );
}
