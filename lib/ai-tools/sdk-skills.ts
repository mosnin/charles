/**
 * SDK-native sub-agent factories.
 *
 * The custom loop's `delegate_to_subagent` (lib/ai-tools/skills/*) hand-rolls
 * routing, system-prompt prefixing, and a tool allowlist per skill. The
 * `@openai/agents` SDK gives all of that for free via `Agent.asTool()`:
 * the parent agent calls a tool, the tool spins up the sub-agent with its
 * own context window + tool subset, returns the final text. Same boundary,
 * a fraction of the code.
 *
 * This module builds the two existing skills as SDK Agents. The chat
 * runtime (`sdk-chat.ts`) attaches them via `.asTool()` so the model
 * picks `analyze_pipeline` / `research_person` instead of the generic
 * `delegate_to_subagent` indirection.
 *
 * The custom loop keeps its own `delegate_to_subagent`. We don't wire it
 * into the SDK runtime — the SDK path uses asTool handoffs and never
 * touches the router.
 */

import { Agent } from '@openai/agents';
import { toSdkTool } from './sdk-bridge';
import { ALL_TOOLS } from './tools';
import type { ToolContext, ToolDefinition } from './types';

const DEFAULT_MODEL = 'gpt-5-mini';

/**
 * Pull tools by name from `ALL_TOOLS`. Unknown names throw at build time —
 * a typo here is a boot failure, not a silent runtime miss.
 */
function pickTools(names: readonly string[]): ToolDefinition[] {
  const byName = new Map(ALL_TOOLS.map((t) => [t.name, t]));
  return names.map((n) => {
    const t = byName.get(n);
    if (!t) throw new Error(`sdk-skills: unknown tool "${n}"`);
    return t;
  });
}

/**
 * Planner — decomposes a complex user task into a concrete multi-step
 * execution plan and surfaces it to the UI via `create_plan` before any
 * domain tools run.
 */
export function buildPlannerAgent(ctx: ToolContext, opts: { model?: string } = {}): Agent {
  const tools = pickTools(['create_plan']).map((t) => toSdkTool(t, ctx));

  return new Agent({
    name: 'planner',
    instructions:
      'Given a complex user task, break it into 3-7 concrete steps. Call create_plan with the full task description and an array of steps. Each step needs a short title (≤6 words) and a one-sentence description of what will happen. Be specific to the actual task — no generic steps.',
    tools,
    model: opts.model ?? DEFAULT_MODEL,
  });
}
