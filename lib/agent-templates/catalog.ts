/**
 * Catalog for the Custom Agent Workflow Builder.
 *
 * Two static lists:
 *   - TRIGGER_TYPES   — what kicks an agent off. Mirrors the CHECK on
 *                       CustomAgent.triggerType.
 *   - SUBAGENT_ROLES  — the role chip on a subagent node in the graph.
 *
 * Both are intentionally tiny — extending either is a schema decision, not
 * a list edit. Add a row here and add the matching value to the migration
 * in the same change.
 */

export type TriggerType = 'manual' | 'schedule' | 'webhook' | 'event';

export const TRIGGER_TYPES: {
  type: TriggerType;
  label: string;
  description: string;
}[] = [
  {
    type: 'manual',
    label: 'Manual',
    description: 'You start it from the Tasks page.',
  },
  {
    type: 'schedule',
    label: 'Schedule',
    description: 'Runs on a cron.',
  },
  {
    type: 'webhook',
    label: 'Webhook',
    description: 'Triggered by an inbound URL.',
  },
  {
    type: 'event',
    label: 'Event',
    description: 'Reacts to an in-app event (new draft, paused run, etc).',
  },
];

export const SUBAGENT_ROLES = [
  'research',
  'planning',
  'copywriting',
  'review',
  'execution',
  'synthesis',
] as const;

export type SubAgentRole = (typeof SUBAGENT_ROLES)[number];

export function isTriggerType(v: unknown): v is TriggerType {
  return (
    typeof v === 'string' &&
    (v === 'manual' || v === 'schedule' || v === 'webhook' || v === 'event')
  );
}

export function isSubAgentRole(v: unknown): v is SubAgentRole {
  return (
    typeof v === 'string' &&
    (SUBAGENT_ROLES as readonly string[]).includes(v)
  );
}
