/**
 * Pure helpers for the per-task / per-gate conversation surface.
 *
 * Three jobs:
 *
 *   1. Render the breadcrumb shown above the split view and inside the chat
 *      pane (e.g. "Engineering / Landing Page Updates").
 *
 *   2. Pick a canonical subject for a fresh TaskConversation row — what
 *      goes into the DB's `subject` column on creation.
 *
 *   3. Classify a free-form user prompt to a single department, so the
 *      canned assistant reply can name who Charles is "delegating to" while
 *      the real agent isn't wired in yet.
 *
 * Pure functions. No DB, no fetch. Unit-testable.
 */

import {
  DEPARTMENT_LABELS,
  type DepartmentSlug,
  type Task,
} from './catalog';
import { STAGES, type Stage } from '@/lib/stages/catalog';

/* ─── Breadcrumbs ──────────────────────────────────────────────────────── */

/**
 * Breadcrumb for a Task. If the task is assigned to a department agent we
 * use that department; otherwise we fall back to "Tasks" because there's
 * no department to name.
 */
export function breadcrumbForTask(task: Pick<Task, 'title' | 'assigneeKind' | 'assigneeDept'>): string {
  const left =
    task.assigneeKind === 'agent' && task.assigneeDept
      ? DEPARTMENT_LABELS[task.assigneeDept]
      : 'Tasks';
  return `${left} / ${task.title.trim()}`;
}

/**
 * Breadcrumb for a StageGate. Stages live under a "Stages" root, then the
 * stage label, then the gate title.
 */
export function breadcrumbForGate(gate: { title: string; stage: Stage }): string {
  const stageLabel = STAGES[gate.stage].label;
  return `Stages / ${stageLabel} / ${gate.title.trim()}`;
}

/* ─── Canonical subjects ───────────────────────────────────────────────── */

/** The subject we stamp on the row when a task conversation is created. */
export function subjectFromTask(task: Pick<Task, 'title'>): string {
  return task.title.trim();
}

/** The subject we stamp on the row when a gate conversation is created. */
export function subjectFromGate(gate: { title: string }): string {
  return gate.title.trim();
}

/* ─── Department classifier ────────────────────────────────────────────── */

/**
 * Map a keyword to the department most likely to own the work.
 *
 * This is intentionally dumb — a flat keyword table, first match wins,
 * lowercase substring. Good enough to make the canned assistant reply
 * feel alive ("I'm delegating this to Engineering.") until the real
 * manager-agent wiring lands in Phase 7.
 *
 * Tie-break: the table order below is the priority order. The first
 * department whose keyword appears in the prompt is the answer.
 */
const KEYWORD_TABLE: ReadonlyArray<{ dept: DepartmentSlug; keywords: readonly string[] }> = [
  {
    dept: 'engineering',
    keywords: [
      'deploy', 'ship', 'build', 'website', 'landing', 'app', 'frontend',
      'backend', 'api', 'database', 'bug', 'fix', 'refactor', 'integrate',
      'integration', 'code', 'repo', 'github', 'vercel',
    ],
  },
  {
    dept: 'design',
    keywords: ['logo', 'brand', 'design', 'wordmark', 'icon', 'mockup', 'wireframe', 'palette'],
  },
  {
    dept: 'marketing',
    keywords: [
      'draft', 'email', 'campaign', 'blog', 'post', 'tweet', 'social',
      'announce', 'launch', 'marketing', 'newsletter', 'copy',
    ],
  },
  {
    dept: 'sales',
    keywords: ['lead', 'prospect', 'outreach', 'pitch', 'pricing', 'sell', 'sales', 'demo', 'discovery'],
  },
  {
    dept: 'support',
    keywords: ['support', 'help', 'ticket', 'reply', 'faq', 'docs', 'onboarding'],
  },
  {
    dept: 'ops_finance',
    keywords: ['invoice', 'stripe', 'billing', 'finance', 'expense', 'runway', 'ops', 'budget', 'tax'],
  },
];

/**
 * Pick a department for a free-text prompt. Returns null when no keyword
 * matches — the caller can show a department-agnostic reply in that case.
 */
export function classifyDepartment(prompt: string): DepartmentSlug | null {
  const text = prompt.toLowerCase();
  if (text.trim().length === 0) return null;

  for (const { dept, keywords } of KEYWORD_TABLE) {
    for (const k of keywords) {
      if (text.includes(k)) return dept;
    }
  }
  return null;
}

/* ─── Canned assistant reply ───────────────────────────────────────────── */

/**
 * The placeholder assistant response until the real manager agent is wired.
 *
 * If a department is detected, we name it and pretend to delegate; if not,
 * we acknowledge and say we're picking it up directly. Either way we keep
 * the voice Charles-correct: first person, periods, no hype, no emoji.
 */
export function cannedAssistantReply(prompt: string): {
  content: string;
  metadata: { delegatedTo: DepartmentSlug | null };
} {
  const dept = classifyDepartment(prompt);
  if (dept) {
    return {
      content: `On it. I'm delegating this to ${DEPARTMENT_LABELS[dept]}. I'll surface the result here when it lands.`,
      metadata: { delegatedTo: dept },
    };
  }
  return {
    content: `Got it. I'll pick this up and bring back the next step here.`,
    metadata: { delegatedTo: null },
  };
}

/** First-message greeting on a fresh task conversation (empty thread). */
export const EMPTY_TASK_GREETING =
  "I'm watching this task. Tell me what you want next and I'll move on it.";
