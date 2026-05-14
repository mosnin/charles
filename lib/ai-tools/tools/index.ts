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

// Memory
import { recallHistoryTool } from './recall-history';
import { readAttachmentTool } from './read-attachment';

// Planning
import { createPlanTool } from './plan';

/**
 * Domain tools only. The orchestrator's `delegate_to_subagent` tool is
 * intentionally NOT in this list — it gets added at the `registry` layer.
 *
 * NOTE: the realtor-era People/Pipeline/Properties/Communication tools were
 * ripped out in the Chippi → Charles cleanup. They queried Contact/Deal/
 * DealContact/DealStage/DealActivity/ContactActivity/Property — none of which
 * survive in the Charles schema. Person/PipelineObject equivalents will be
 * added in a later phase once the Charles agent runtime needs them.
 */
export const ALL_TOOLS: ToolDefinition[] = [
  // ── Memory ─────────────────────────────────────────────────────────────
  recallHistoryTool as ToolDefinition,
  readAttachmentTool as ToolDefinition,

  // ── Planning ───────────────────────────────────────────────────────────
  createPlanTool as ToolDefinition,
];
