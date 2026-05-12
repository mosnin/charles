/**
 * System prompt for the on-demand agent loop.
 *
 * Kept in one place so every loop turn — and the approval resume path —
 * sees the same instructions. The prompt is short, concrete, and
 * context-sensitive: workspace, today's date, mission context, and core
 * memory are baked in so the model doesn't have to ask.
 *
 * What we avoid: safety lectures, lengthy persona, or enumerating every
 * tool. The tools array sent alongside the request is already discoverable
 * by the model; duplicating it here wastes tokens and invites drift.
 *
 * Two builders:
 *   - `buildSystemPrompt(ctx)` — synchronous, no DB. Used in tests and as
 *     the static fallback if the personalization fetch fails.
 *   - `buildPersonalizedSystemPrompt(ctx)` — async, fetches the snapshot.
 *     This is what the chat runtime actually calls.
 *
 * Mission context:
 *   Pass `missionContext` to inject Mission + CoreMemory + Stage at the top
 *   of every prompt. Omit it for backward-compatible static/test usage.
 */

import type { ToolContext } from './types';
import { buildPersonalizedSnapshot, renderSnapshot } from './personalized-prompt';
import { logger } from '@/lib/logger';

/** Inline Mission shape — mirrors the DB table written by the migration agent. */
export interface Mission {
  id: string;
  spaceId: string;
  title: string | null;
  description: string | null;
  oneLinePitch: string | null;
  targetCustomer: string | null;
  stage: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Caller-supplied mission + core memory context. All fields are optional so
 *  a partially-filled workspace produces a useful prompt rather than throwing. */
export interface MissionContext {
  mission: Mission | null;
  /** { slot: value } from CoreMemory — null values are "(not set)". */
  core: Record<string, string | null>;
  /** Current WorkspaceStage.stage value. Defaults to 'idea' if absent. */
  stage: string;
}

interface BuildOptions {
  /** Override the current date for deterministic tests. */
  now?: Date;
  /** When provided, prepends mission + core memory at the top of the prompt. */
  missionContext?: MissionContext;
}

/**
 * Static prompt — no personalization. The synchronous shape stays so
 * tests and read-only contexts (resume path before history loads) have a
 * deterministic baseline.
 */
export function buildSystemPrompt(ctx: ToolContext, opts: BuildOptions = {}): string {
  return composePrompt(ctx, opts, '');
}

/**
 * Personalized prompt — same baseline plus a snapshot block (connected apps,
 * workspace summary). Cached for 5 minutes per (space,user) so a multi-turn
 * session pays the snapshot cost once.
 */
export async function buildPersonalizedSystemPrompt(
  ctx: ToolContext,
  opts: BuildOptions = {},
): Promise<string> {
  let snapshotBlock = '';
  try {
    const snap = await buildPersonalizedSnapshot({
      spaceId: ctx.space.id,
      userId: ctx.userId,
    });
    snapshotBlock = renderSnapshot(snap);
  } catch (err) {
    logger.warn('[system-prompt] personalization fetch failed — using static prompt', {
      spaceId: ctx.space.id,
      err: err instanceof Error ? err.message : String(err),
    });
  }
  return composePrompt(ctx, opts, snapshotBlock);
}

/** Render the mission + core memory block prepended to the prompt. */
function renderMissionBlock(mc: MissionContext): string {
  const { mission, core, stage } = mc;
  const lines: string[] = [
    '## Company Mission',
    `Mission: ${mission?.title ?? '(not set)'}`,
    `Stage: ${stage || 'idea'}`,
    `One-line pitch: ${mission?.oneLinePitch ?? '(not set)'}`,
    `Target customer: ${mission?.targetCustomer ?? '(not set)'}`,
    '',
    '## Core Memory',
  ];

  const entries = Object.entries(core);
  if (entries.length === 0) {
    lines.push('(no core memory set)');
  } else {
    for (const [slot, value] of entries) {
      lines.push(`- ${slot}: ${value ?? '(not set)'}`);
    }
  }

  return lines.join('\n');
}

function composePrompt(ctx: ToolContext, opts: BuildOptions, snapshotBlock: string): string {
  const now = opts.now ?? new Date();
  const today = now.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const lines: string[] = [];

  // Mission + core memory — prepended when the caller supplies context so the
  // model has company identity before any other instructions.
  if (opts.missionContext) {
    lines.push(renderMissionBlock(opts.missionContext), '');
  }

  lines.push(
    `You are Charles, an AI cofounder that helps founders ship and grow their startup.`,
    ``,
    `Workspace: "${ctx.space.name}"`,
    `Today: ${today}`,
  );

  // Snapshot block — only included when we have at least one fact. The
  // empty state ("zero of everything") would sound like a brand-new
  // account every turn; the static prompt is better.
  if (snapshotBlock) {
    lines.push('', snapshotBlock);
  }

  lines.push(
    ``,
    `# Tool-first. Always.`,
    `Never invent data. Look it up. If a tool returns nothing, say so — don't fabricate. When a question is answerable with a tool call, make the call before typing a guess.`,
    ``,
    `# Autonomous multi-step execution`,
    `You have up to 15 tool turns per reply. Use them. When a task requires a chain — read repo state → write a file → open a PR — execute every step in sequence WITHOUT stopping to ask for permission or progress updates between steps. Complete the full task, THEN surface the result.`,
    ``,
    `Concretely:`,
    `- Chain tools in sequence whenever one result feeds the next. Do not stop mid-chain to narrate progress.`,
    `- If a step returns zero results, skip it and continue to the remaining steps — don't halt the whole task.`,
    `- Batch reads first, write or mutate second. Understand the current state before changing it.`,
    ``,
    `# Planning mode — when to use \`planner\``,
    `Call \`planner\` FIRST — before any other tool — when a task requires 3 or more tool calls OR coordinates across multiple systems (e.g. GitHub + Linear + Stripe). The plan is shown to the founder before execution; after that, execute every announced step in order. Skip a step only if a lookup returns nothing — never add unannounced steps silently.`,
    ``,
    `# Mutations and approval`,
    `- Mutating tools (push to GitHub, send email, create Stripe payment link, etc.) always require founder approval. Trust that the platform handles the approval flow — after the user decides, continue executing remaining steps without re-asking.`,
    `- Sending verbs ("send", "push", "deploy", "post") act through the founder's connected accounts. Drafting verbs ("draft", "compose", "write") produce text for review. When the verb is ambiguous, draft.`,
    `- When a batch action is requested (e.g. "email all beta users"), read to identify the full list FIRST, then propose — do not fire sends without confirmation.`,
    ``,
    `# Pre-mutation intent statement`,
    `BEFORE calling a mutating tool, write one short sentence naming WHAT you're about to do and WHY. Plain text, in the same turn, immediately before the tool call. Skip this only when the user's message already makes both obvious.`,
    ``,
    `# Asking`,
    `If intent is genuinely ambiguous and no tool call would resolve it, ask one short question. Don't ask for information a tool call would supply. Don't ask for progress updates mid-chain — finish the chain first.`,
    ``,
    `# Boundaries`,
    `- Never reveal internal IDs, raw API keys, or per-row metadata in your reply.`,
    `- Never claim a write you didn't execute. "Drafted" if drafted; "pushed" if pushed.`,
    `- On tool error, surface briefly and continue to remaining steps. Don't loop on a single failed call.`,
    `- When you have nothing useful to add, say so plainly. One-sentence answers are fine.`,
    ``,
    `Tone: direct, precise, low noise. Lead with the result; keep reasoning to one or two sentences unless the founder asks for more.`,
  );

  return lines.join('\n');
}
