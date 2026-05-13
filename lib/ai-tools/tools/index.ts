/**
 * All tools known to the TS runtime registry.
 *
 * ─── Runtime split ────────────────────────────────────────────────────────
 *
 * These tools run in the Next.js in-process runtime (approval-resume path
 * and in-process sub-agent skills). The primary agent runtime is Modal/Python
 * (agent/manager/charles.py + agent/departments/*). The two catalogs are
 * hand-maintained; tools added here must have a Python equivalent to be
 * visible to Charles and the department agents.
 *
 * ─── Contract ─────────────────────────────────────────────────────────────
 *
 * Every tool is enforced at compile time via the discriminated union in
 * `lib/ai-tools/types.ts`: mutating tools must have `summariseCall` and
 * `rateLimit`. Drift the types can't catch is enforced by
 * `tests/lib/ai-tools-registry-contract.test.ts`.
 */

import type { ToolDefinition } from '../types';

// People
import { findPersonTool } from './find-person';
import { addPersonTool } from './add-person';
import { setFollowupTool } from './set-followup';
import { clearFollowupTool } from './clear-followup';
import { markPersonHotTool } from './mark-person-hot';
import { markPersonColdTool } from './mark-person-cold';
import { archivePersonTool } from './archive-person';
import { noteOnPersonTool } from './note-on-person';

// Pipeline
import { createDealTool } from './create-deal';
import { noteOnDealTool } from './note-on-deal';
import { addChecklistItemTool } from './add-checklist-item';

// Properties
import { findPropertyTool } from './find-property';

// Communication
import { sendEmailTool } from './send-email';

// Memory
import { recallHistoryTool } from './recall-history';
import { readAttachmentTool } from './read-attachment';

// Planning
import { createPlanTool } from './plan';

/**
 * Domain tools only. The orchestrator's `delegate_to_subagent` tool is
 * intentionally NOT in this list — it gets added at the `registry` layer.
 */
export const ALL_TOOLS: ToolDefinition[] = [
  // ── People ─────────────────────────────────────────────────────────────
  findPersonTool as ToolDefinition,
  addPersonTool as ToolDefinition,
  setFollowupTool as ToolDefinition,
  clearFollowupTool as ToolDefinition,
  markPersonHotTool as ToolDefinition,
  markPersonColdTool as ToolDefinition,
  archivePersonTool as ToolDefinition,
  noteOnPersonTool as ToolDefinition,

  // ── Pipeline ───────────────────────────────────────────────────────────
  createDealTool as ToolDefinition,
  noteOnDealTool as ToolDefinition,
  addChecklistItemTool as ToolDefinition,

  // ── Properties ─────────────────────────────────────────────────────────
  findPropertyTool as ToolDefinition,

  // ── Communication ──────────────────────────────────────────────────────
  sendEmailTool as ToolDefinition,

  // ── Memory ─────────────────────────────────────────────────────────────
  recallHistoryTool as ToolDefinition,
  readAttachmentTool as ToolDefinition,

  // ── Planning ───────────────────────────────────────────────────────────
  createPlanTool as ToolDefinition,
];
