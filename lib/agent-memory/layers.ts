/**
 * Memory layer loader for the Charles agent runtime.
 *
 * Three layers, loaded in one call:
 *   - core:    All CoreMemory slots for the space (slot → value). These are
 *              the "always-on" facts: company name, stage, product description,
 *              etc. Written by the agent and founder via setCoreSlot.
 *   - working: Per-turn scratchpad. Starts empty; callers populate it.
 *   - recent:  Top-k long-term AgentMemory hits via vector recall. Only
 *              fetched when a query string is provided — skip on turns where
 *              context is already available.
 *
 * The Supabase client follows the same pattern as lib/agent-memory/store.ts:
 * `import { supabase } from '@/lib/supabase'` — service-role, server-side only.
 */

import { supabase } from '@/lib/supabase';
import { embed } from './embed';

function vectorLiteral(vec: number[]): string {
  return '[' + vec.map((x) => x.toFixed(7)).join(',') + ']';
}

export interface MemoryLayers {
  /** { slot: value } for all CoreMemory rows in this space. */
  core: Record<string, string | null>;
  /** Per-turn scratchpad — starts empty, callers populate. */
  working: Record<string, unknown>;
  /** Top-k AgentMemory hits. Empty when no query is provided. */
  recent: Array<{
    id: string;
    content: string;
    importance: number;
    createdAt: string;
  }>;
}

interface RpcRow {
  id: string;
  content: string;
  importance: number;
  createdAt: string;
}

/**
 * Load all three memory layers for a space in parallel where possible.
 *
 * @param spaceId  The workspace to scope reads to.
 * @param query    If provided, triggers a vector recall against AgentMemory.
 *                 Omit on turns where semantic recall is not needed.
 * @param topK     Maximum AgentMemory hits returned. Default 8, capped at 50.
 */
export async function loadMemoryLayers(
  spaceId: string,
  query?: string,
  topK = 8,
): Promise<MemoryLayers> {
  const k = Math.max(1, Math.min(50, topK));

  // Core memory fetch and optional vector recall run in parallel.
  const [coreRows, recentRows] = await Promise.all([
    supabase.from('CoreMemory').select('slot, value').eq('spaceId', spaceId),
    query ? fetchRecent(spaceId, query, k) : Promise.resolve([]),
  ]);

  const core: Record<string, string | null> = {};
  for (const row of coreRows.data ?? []) {
    core[(row as { slot: string; value: string | null }).slot] =
      (row as { slot: string; value: string | null }).value;
  }

  return { core, working: {}, recent: recentRows };
}

async function fetchRecent(
  spaceId: string,
  query: string,
  k: number,
): Promise<MemoryLayers['recent']> {
  const cleaned = query.trim();
  if (!cleaned) return [];

  const vec = await embed(cleaned);

  const { data, error } = await supabase.rpc('match_agent_memory', {
    query_embedding: vectorLiteral(vec),
    match_space_id: spaceId,
    match_count: k,
    filter_memory_type: null,
    filter_entity_type: null,
    filter_entity_id: null,
    min_similarity: 0,
  });

  if (error) {
    throw new Error(`loadMemoryLayers: recall rpc failed: ${error.message}`);
  }

  return ((data ?? []) as RpcRow[]).map((r) => ({
    id: r.id,
    content: r.content,
    importance: r.importance,
    createdAt: r.createdAt,
  }));
}

/**
 * Upsert a single CoreMemory slot. Creates the row if it doesn't exist,
 * updates it if it does. UNIQUE(spaceId, slot) is enforced at the DB level.
 */
export async function setCoreSlot(
  spaceId: string,
  slot: string,
  value: string,
): Promise<void> {
  const { error } = await supabase
    .from('CoreMemory')
    .upsert({ spaceId, slot, value }, { onConflict: 'spaceId,slot' });

  if (error) {
    throw new Error(`setCoreSlot: upsert failed: ${error.message}`);
  }
}

/**
 * Render the core memory map as a prompt block.
 * Only non-null slots are emitted by default to keep prompts tight.
 *
 * @param includeEmpty  If true, emit `(not set)` for null slots. Useful for
 *                      the founder-facing "memory inspector" view.
 */
export function formatCoreForPrompt(
  core: Record<string, string | null>,
  includeEmpty = false,
): string {
  const lines = ['## Core Memory'];
  for (const [slot, value] of Object.entries(core)) {
    if (value === null && !includeEmpty) continue;
    lines.push(`- ${slot}: ${value ?? '(not set)'}`);
  }
  if (lines.length === 1) {
    lines.push('(no core memory set)');
  }
  return lines.join('\n');
}
