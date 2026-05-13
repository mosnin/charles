/**
 * Chat-dock home tab feed — pure mapper from `AuditEvent[]` to a render
 * model. No React, no DOM, no Supabase. Lives here so the dock component
 * stays a thin renderer and we can test the mapping in isolation.
 *
 * Two kinds of rows the dock cares about:
 *   - `subagent` — agent_run_started / running / completed → SubagentChip
 *   - `text` — everything else → plain text row with optional dept icon
 *
 * Status & duration on the subagent row are derived from the event type.
 * Started rows render Running; completed rows render Done with a duration
 * if we can compute one (we can't without `startedAt` in the event, so
 * duration stays unset — the chip handles undefined gracefully).
 */

import type { AuditEvent } from '@/lib/observability/audit-feed';
import { isDepartmentSlug, type DepartmentSlug } from '@/lib/departments/autonomy';
import type { SubagentStatus } from '@/components/canvas/subagent-chip';

export interface DockSubagentRow {
  kind: 'subagent';
  id: string;
  department: DepartmentSlug;
  agentName: string;
  task: string;
  status: SubagentStatus;
  duration?: string;
  occurredAt: string;
}

export interface DockTextRow {
  kind: 'text';
  id: string;
  /** Optional — only set if the event has a recognised department. */
  department?: DepartmentSlug;
  summary: string;
  occurredAt: string;
}

export type DockRow = DockSubagentRow | DockTextRow;

/**
 * Split an event summary of shape "Name started: task" or "Name completed:
 * task" into its two halves. If the colon is missing we fall back to the
 * full summary as the task and "Agent" as the name.
 */
function splitNameAndTask(summary: string): { name: string; task: string } {
  // Match "Name <verb>: rest" — verb is one or two words.
  const m = summary.match(/^(.+?)\s+(?:started|completed|failed):\s*(.*)$/);
  if (m) {
    return { name: m[1].trim(), task: m[2].trim() };
  }
  return { name: 'Agent', task: summary };
}

export function eventsToDockRows(events: AuditEvent[]): DockRow[] {
  const rows: DockRow[] = [];
  for (const e of events) {
    if (e.type === 'agent_run_started') {
      if (!isDepartmentSlug(e.department)) {
        rows.push({
          kind: 'text',
          id: e.id,
          summary: e.summary,
          occurredAt: e.occurredAt,
        });
        continue;
      }
      const { name, task } = splitNameAndTask(e.summary);
      rows.push({
        kind: 'subagent',
        id: e.id,
        department: e.department,
        agentName: name,
        task,
        status: 'running',
        occurredAt: e.occurredAt,
      });
    } else if (e.type === 'agent_run_completed') {
      if (!isDepartmentSlug(e.department)) {
        rows.push({
          kind: 'text',
          id: e.id,
          summary: e.summary,
          occurredAt: e.occurredAt,
        });
        continue;
      }
      const { name, task } = splitNameAndTask(e.summary);
      rows.push({
        kind: 'subagent',
        id: e.id,
        department: e.department,
        agentName: name,
        task,
        status: 'done',
        occurredAt: e.occurredAt,
      });
    } else {
      rows.push({
        kind: 'text',
        id: e.id,
        department: isDepartmentSlug(e.department) ? e.department : undefined,
        summary: e.summary,
        occurredAt: e.occurredAt,
      });
    }
  }
  return rows;
}
