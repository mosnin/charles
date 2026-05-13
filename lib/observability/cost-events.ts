/**
 * Cost event logging — best-effort writes to the CostEvent table.
 *
 * Callers should never await a failed insert. A cost row failing to land
 * is a logging problem, not a correctness problem; we swallow the error,
 * log a warning, and let the run keep going. Read paths (loadRollup) call
 * the SQL function rollup_cost_by_day and tolerate an empty result.
 *
 * Mirrors agent/lib/cost_events.py. Keep the model price table in sync
 * across the two files — there is no shared source.
 */
import { supabase } from '@/lib/supabase';

export type Department =
  | 'engineering'
  | 'sales'
  | 'marketing'
  | 'design'
  | 'support'
  | 'ops_finance'
  | 'manager'
  | 'in_process';

export interface CostEventInput {
  spaceId: string;
  department?: Department;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  runId?: string;
  toolName?: string;
}

export interface RollupRow {
  day: string;            // YYYY-MM-DD
  department: string;
  model: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
}

// Prices last reviewed 2026-05; cross-check provider pricing pages quarterly.
// Values are USD per 1M tokens — [inputPer1M, outputPer1M].
export const MODEL_PRICES: Record<string, readonly [number, number]> = {
  'gpt-5':            [1.25, 10.00],
  'gpt-5-mini':       [0.25, 2.00],
  'gpt-5-nano':       [0.05, 0.40],
  'claude-opus-4-7':  [15.00, 75.00],
  'claude-sonnet-4-6':[3.00, 15.00],
  'claude-haiku-4-5': [0.80, 4.00],
  'gpt-4o-mini':      [0.15, 0.60],
};

// Track which unknown models we've already warned about so we don't spam
// the logs. Per-process memory; resets on cold start, which is fine.
const _warnedUnknownModels = new Set<string>();

/**
 * Estimate the USD cost of a call. Returns 0 for unknown models (after
 * logging a one-time warning) so callers can keep going without a price.
 */
export function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const prices = MODEL_PRICES[model];
  if (!prices) {
    if (!_warnedUnknownModels.has(model)) {
      _warnedUnknownModels.add(model);
      console.warn(
        `[cost-events] Unknown model "${model}" — pricing unavailable. ` +
          `Add it to MODEL_PRICES in lib/observability/cost-events.ts.`,
      );
    }
    return 0;
  }
  const [inPer1M, outPer1M] = prices;
  const inCost = (Math.max(0, inputTokens) / 1_000_000) * inPer1M;
  const outCost = (Math.max(0, outputTokens) / 1_000_000) * outPer1M;
  // Round to six decimal places to match the column's numeric(12,6).
  return Math.round((inCost + outCost) * 1_000_000) / 1_000_000;
}

/**
 * Insert one cost event. Best-effort: never throws.
 *
 * If `costUsd` is omitted, we estimate it from `model` + tokens.
 */
export async function emitCostEvent(input: CostEventInput): Promise<void> {
  try {
    if (!input.spaceId || !input.model) {
      console.warn('[cost-events] Missing spaceId or model; skipping insert.');
      return;
    }

    const inputTokens = input.inputTokens ?? 0;
    const outputTokens = input.outputTokens ?? 0;
    const costUsd =
      input.costUsd ?? estimateCost(input.model, inputTokens, outputTokens);

    const row: Record<string, unknown> = {
      spaceId: input.spaceId,
      department: input.department ?? null,
      model: input.model,
      inputTokens,
      outputTokens,
      costUsd,
    };
    if (input.runId) row.runId = input.runId;
    if (input.toolName) row.toolName = input.toolName;

    const { error } = await supabase.from('CostEvent').insert(row);
    if (error) {
      console.warn(`[cost-events] Insert failed: ${error.message}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[cost-events] Unexpected error during insert: ${msg}`);
  }
}

/**
 * Load the per-day / per-department / per-model rollup. Returns [] on any
 * error so the dashboard can render the empty state rather than 500.
 */
export async function loadRollup(
  spaceId: string,
  days: number = 30,
): Promise<RollupRow[]> {
  try {
    if (!spaceId) return [];
    const { data, error } = await supabase.rpc('rollup_cost_by_day', {
      p_space_id: spaceId,
      p_days: days,
    });
    if (error) {
      console.warn(`[cost-events] Rollup query failed: ${error.message}`);
      return [];
    }
    const rows = (data ?? []) as Array<{
      day: string;
      department: string | null;
      model: string;
      total_input: number | string;
      total_output: number | string;
      total_cost: number | string;
    }>;
    return rows.map((r) => ({
      day: typeof r.day === 'string' ? r.day.slice(0, 10) : String(r.day).slice(0, 10),
      department: r.department ?? 'in_process',
      model: r.model,
      totalInputTokens: Number(r.total_input ?? 0),
      totalOutputTokens: Number(r.total_output ?? 0),
      totalCostUsd: Number(r.total_cost ?? 0),
    }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[cost-events] Unexpected error during rollup: ${msg}`);
    return [];
  }
}

// Test-only helper to reset the unknown-model warning cache.
export function _resetWarnedModels(): void {
  _warnedUnknownModels.clear();
}
