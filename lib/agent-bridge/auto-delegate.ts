/**
 * Auto-delegation helper for the chat message route.
 *
 * Wave 1A owns app/api/task-conversations/[id]/messages/route.ts and is
 * wiring the OpenAI chat path. When their classifier produces a message
 * with metadata.delegatedTo set to one of the six department slugs, they
 * call this helper to fire-and-forget a department delegation through
 * the Python bridge. The result eventually shows up as a new TaskMessage
 * persisted by the Python side.
 *
 * Contract:
 *  - Non-throwing. Logs and returns. The chat reply must never fail
 *    because the bridge is misconfigured.
 *  - Detached. We swallow the promise — callers don't await this.
 *  - Idempotent on bad input. Bogus department → no-op + warn.
 */

import { callDelegate, DEPARTMENTS, type Department } from './client';

export interface AutoDelegateArgs {
  spaceId: string;
  conversationId?: string;
  /** The department slug the chat classifier picked. */
  department: string;
  /** The user's original message — used as the task description. */
  task: string;
  /** Optional extra context (e.g. recent conversation summary). */
  context?: string;
}

function isDepartment(dept: string): dept is Department {
  return (DEPARTMENTS as readonly string[]).includes(dept);
}

/**
 * Fire-and-forget a delegation. Returns immediately. Errors are logged
 * but never thrown — the chat reply must keep moving.
 */
export function autoDelegate(args: AutoDelegateArgs): void {
  if (!args.department || !isDepartment(args.department)) {
    console.warn('[auto-delegate] skipped: invalid department', args.department);
    return;
  }
  if (!args.spaceId || !args.task) {
    console.warn('[auto-delegate] skipped: missing spaceId or task');
    return;
  }

  // Detached. We attach a catch so the unhandled-rejection logger stays quiet.
  callDelegate({
    spaceId: args.spaceId,
    runId: args.conversationId,
    department: args.department,
    task: args.task,
    context: args.context,
  }).catch((err) => {
    console.error('[auto-delegate] bridge call failed', {
      department: args.department,
      spaceId: args.spaceId,
      error: err instanceof Error ? err.message : String(err),
    });
  });
}
