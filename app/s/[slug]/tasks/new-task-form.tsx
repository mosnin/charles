'use client';

/**
 * Quick-create form for a new task. Opens as a small inline drawer pinned to
 * the page header — title-first, priority and assignee as quiet selects, a
 * single primary button. No modal backdrop. Escape closes.
 *
 * On success: router.refresh() so the server component re-reads.
 * On failure: a toast, no state thrown away.
 */

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Plus, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  DEPARTMENT_LABELS,
  DEPARTMENT_SLUGS,
  type DepartmentSlug,
  type TaskAssigneeKind,
  type TaskPriority,
} from '@/lib/tasks/catalog';

type AssigneeChoice = 'founder' | 'unassigned' | DepartmentSlug;

export function NewTaskForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('normal');
  const [assignee, setAssignee] = useState<AssigneeChoice>('founder');
  const [submitting, setSubmitting] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      titleRef.current?.focus();
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false);
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  function reset() {
    setTitle('');
    setDescription('');
    setPriority('normal');
    setAssignee('founder');
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const t = title.trim();
    if (!t) {
      toast.error('Title is required.');
      titleRef.current?.focus();
      return;
    }
    setSubmitting(true);

    let assigneeKind: TaskAssigneeKind = 'founder';
    let assigneeDept: DepartmentSlug | undefined;
    if (assignee === 'founder' || assignee === 'unassigned') {
      assigneeKind = assignee;
    } else {
      assigneeKind = 'agent';
      assigneeDept = assignee;
    }

    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: t,
          description: description.trim() || undefined,
          priority,
          assigneeKind,
          assigneeDept,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(body.error ?? 'Could not create the task.');
        setSubmitting(false);
        return;
      }
      reset();
      setOpen(false);
      router.refresh();
    } catch {
      toast.error('Network error. Try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          'inline-flex items-center gap-1.5 h-9 px-4 rounded-md',
          'bg-foreground text-background text-sm font-medium',
          'transition-all duration-150 active:scale-[0.98]',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/30',
          'focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        )}
      >
        <Plus size={14} strokeWidth={2} />
        New task
      </button>
    );
  }

  return (
    <form
      onSubmit={submit}
      className={cn(
        'w-full max-w-md space-y-3 rounded-xl border border-border bg-card p-4',
        'shadow-none',
      )}
    >
      <div className="flex items-start gap-2">
        <input
          ref={titleRef}
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="What needs doing?"
          maxLength={200}
          className={cn(
            'flex-1 h-9 px-3 rounded-md border border-border bg-background',
            'text-sm text-foreground placeholder:text-muted-foreground/60',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/20',
          )}
        />
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="h-9 w-9 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-foreground/[0.04] transition-colors"
          aria-label="Close"
        >
          <X size={14} />
        </button>
      </div>

      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Details (optional)"
        maxLength={2000}
        rows={2}
        className={cn(
          'block w-full px-3 py-2 rounded-md border border-border bg-background',
          'text-sm text-foreground placeholder:text-muted-foreground/60 resize-none',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/20',
        )}
      />

      <div className="flex items-center gap-2">
        <label className="sr-only" htmlFor="task-priority">Priority</label>
        <select
          id="task-priority"
          value={priority}
          onChange={(e) => setPriority(e.target.value as TaskPriority)}
          className={cn(
            'h-9 px-2 rounded-md border border-border bg-background',
            'text-sm text-foreground',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/20',
          )}
        >
          <option value="low">Low</option>
          <option value="normal">Normal</option>
          <option value="high">High</option>
        </select>

        <label className="sr-only" htmlFor="task-assignee">Assignee</label>
        <select
          id="task-assignee"
          value={assignee}
          onChange={(e) => setAssignee(e.target.value as AssigneeChoice)}
          className={cn(
            'h-9 px-2 rounded-md border border-border bg-background',
            'text-sm text-foreground',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/20',
          )}
        >
          <option value="founder">You</option>
          <option value="unassigned">Unassigned</option>
          {DEPARTMENT_SLUGS.map((dep) => (
            <option key={dep} value={dep}>
              {DEPARTMENT_LABELS[dep]}
            </option>
          ))}
        </select>

        <button
          type="submit"
          disabled={submitting || title.trim().length === 0}
          className={cn(
            'ml-auto inline-flex items-center gap-1.5 h-9 px-4 rounded-md',
            'bg-foreground text-background text-sm font-medium',
            'transition-all duration-150 active:scale-[0.98]',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/30',
            'focus-visible:ring-offset-2 focus-visible:ring-offset-background',
            'disabled:opacity-50 disabled:cursor-not-allowed',
          )}
        >
          {submitting ? 'Adding…' : 'Add task'}
        </button>
      </div>
    </form>
  );
}
