/**
 * Tasks — shared to-do surface for the founder and Charles.
 *
 * The schema lives in supabase/migrations/20260606000009_charles_tasks.sql.
 * This file is the TypeScript catalog the rest of the app reads from: types,
 * labels, and a single helper to ask "is this task still live?".
 *
 * The six department slugs match Charles's department registry exactly; if
 * those ever change, this file and the migration's CHECK constraint move
 * together.
 */

export type TaskStatus = 'open' | 'in_progress' | 'done' | 'cancelled';
export type TaskPriority = 'low' | 'normal' | 'high';
export type TaskAssigneeKind = 'founder' | 'agent' | 'unassigned';
export type DepartmentSlug =
  | 'engineering'
  | 'sales'
  | 'marketing'
  | 'design'
  | 'support'
  | 'ops_finance';

export interface Task {
  id: string;
  spaceId: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  assigneeKind: TaskAssigneeKind;
  assigneeDept: DepartmentSlug | null;
  createdBy: 'founder' | 'agent';
  createdByDept: DepartmentSlug | 'manager' | null;
  dueAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export const STATUS_LABELS: Record<TaskStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  done: 'Done',
  cancelled: 'Cancelled',
};

export const PRIORITY_LABELS: Record<TaskPriority, string> = {
  low: 'Low',
  normal: 'Normal',
  high: 'High',
};

export const DEPARTMENT_LABELS: Record<DepartmentSlug, string> = {
  engineering: 'Engineering',
  sales: 'Sales',
  marketing: 'Marketing',
  design: 'Design',
  support: 'Support',
  ops_finance: 'Ops / Finance',
};

export const DEPARTMENT_SLUGS: readonly DepartmentSlug[] = [
  'engineering',
  'sales',
  'marketing',
  'design',
  'support',
  'ops_finance',
] as const;

export const TASK_STATUSES: readonly TaskStatus[] = [
  'open',
  'in_progress',
  'done',
  'cancelled',
] as const;

export const TASK_PRIORITIES: readonly TaskPriority[] = ['low', 'normal', 'high'] as const;

/** A task is "open" if it's still in play — not done, not cancelled. */
export function isOpen(status: TaskStatus): boolean {
  return status === 'open' || status === 'in_progress';
}

export function isDepartmentSlug(s: string): s is DepartmentSlug {
  return (DEPARTMENT_SLUGS as readonly string[]).includes(s);
}

export function isTaskStatus(s: string): s is TaskStatus {
  return (TASK_STATUSES as readonly string[]).includes(s);
}

export function isTaskPriority(s: string): s is TaskPriority {
  return (TASK_PRIORITIES as readonly string[]).includes(s);
}
