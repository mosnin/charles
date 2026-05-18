/**
 * Tests for lib/observability/cost-events.ts.
 *
 * The contract:
 *   - emitCostEvent is best-effort: never throws, even on insert errors.
 *   - estimateCost is the price book; unknown models return 0 and warn once.
 *   - loadRollup transforms RPC rows into camelCase RollupRow and returns
 *     [] on any error so the dashboard never crashes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── In-memory supabase mock ──
type InsertRow = Record<string, unknown>;
let insertedRows: InsertRow[] = [];
let nextInsertError: { message: string } | null = null;
let nextRpcResult: { data: unknown; error: { message: string } | null } = {
  data: [],
  error: null,
};
const rpcCalls: Array<{ fn: string; args: unknown }> = [];

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (_table: string) => ({
      insert(row: InsertRow) {
        if (nextInsertError) {
          return Promise.resolve({ data: null, error: nextInsertError });
        }
        insertedRows.push(row);
        return Promise.resolve({ data: null, error: null });
      },
    }),
    rpc: (fn: string, args: unknown) => {
      rpcCalls.push({ fn, args });
      return Promise.resolve(nextRpcResult);
    },
  },
}));

import {
  emitCostEvent,
  estimateCost,
  loadRollup,
  MODEL_PRICES,
  _resetWarnedModels,
} from '@/lib/observability/cost-events';

beforeEach(() => {
  insertedRows = [];
  nextInsertError = null;
  nextRpcResult = { data: [], error: null };
  rpcCalls.length = 0;
  _resetWarnedModels();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

// ── MODEL_PRICES — the seven prices we ship with ──
describe('MODEL_PRICES', () => {
  it('ships exactly the seven documented models', () => {
    expect(Object.keys(MODEL_PRICES).sort()).toEqual(
      [
        'claude-haiku-4-5',
        'claude-opus-4-7',
        'claude-sonnet-4-6',
        'gpt-4o-mini',
        'gpt-5',
        'gpt-5-mini',
        'gpt-5-nano',
      ].sort(),
    );
  });

  it.each([
    ['gpt-5', 1.25, 10.0],
    ['gpt-5-mini', 0.25, 2.0],
    ['gpt-5-nano', 0.05, 0.4],
    ['claude-opus-4-7', 15.0, 75.0],
    ['claude-sonnet-4-6', 3.0, 15.0],
    ['claude-haiku-4-5', 0.8, 4.0],
    ['gpt-4o-mini', 0.15, 0.6],
  ])('%s prices to ($%s, $%s) per 1M tokens', (model, inP, outP) => {
    expect(MODEL_PRICES[model as keyof typeof MODEL_PRICES]).toEqual([inP, outP]);
  });
});

// ── estimateCost ──
describe('estimateCost', () => {
  it('returns 0 for the zero call', () => {
    expect(estimateCost('gpt-5-mini', 0, 0)).toBe(0);
  });

  it('computes gpt-5-mini cost correctly for 1M in, 1M out', () => {
    // 0.25 + 2.00 = 2.25
    expect(estimateCost('gpt-5-mini', 1_000_000, 1_000_000)).toBeCloseTo(2.25, 6);
  });

  it('computes claude-opus-4-7 cost correctly', () => {
    // 1k in, 1k out → 0.015 + 0.075 = 0.09
    expect(estimateCost('claude-opus-4-7', 1000, 1000)).toBeCloseTo(0.09, 6);
  });

  it('rounds to six decimals to match the DB column', () => {
    const v = estimateCost('gpt-5-nano', 1, 1);
    // 0.05/1e6 + 0.4/1e6 = 4.5e-7; rounded to 6 decimals = 0 or 0.000000
    expect(v).toBe(0);
  });

  it('returns 0 for unknown models', () => {
    expect(estimateCost('mystery-model-9000', 1000, 1000)).toBe(0);
  });

  it('warns once per unknown model', () => {
    const spy = vi.spyOn(console, 'warn');
    estimateCost('mystery-model-9000', 1, 1);
    estimateCost('mystery-model-9000', 1, 1);
    estimateCost('mystery-model-9000', 1, 1);
    // Exactly one warning for the same unknown model.
    expect(spy.mock.calls.filter((c) => String(c[0]).includes('mystery-model-9000'))).toHaveLength(1);
  });

  it('clamps negative token counts to zero', () => {
    expect(estimateCost('gpt-5', -1000, -1000)).toBe(0);
  });
});

// ── emitCostEvent ──
describe('emitCostEvent', () => {
  it('inserts a row with the provided fields', async () => {
    await emitCostEvent({
      spaceId: 'space_1',
      department: 'engineering',
      model: 'gpt-5-mini',
      inputTokens: 1000,
      outputTokens: 500,
      costUsd: 0.0035,
      runId: 'run_1',
      toolName: 'github_create_repo',
    });
    expect(insertedRows).toHaveLength(1);
    expect(insertedRows[0]).toMatchObject({
      spaceId: 'space_1',
      department: 'engineering',
      model: 'gpt-5-mini',
      inputTokens: 1000,
      outputTokens: 500,
      costUsd: 0.0035,
      runId: 'run_1',
      toolName: 'github_create_repo',
    });
  });

  it('estimates costUsd when caller omits it', async () => {
    await emitCostEvent({
      spaceId: 'space_1',
      department: 'manager',
      model: 'gpt-5-mini',
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });
    expect(insertedRows[0].costUsd).toBeCloseTo(2.25, 6);
  });

  it('defaults department to null when omitted', async () => {
    await emitCostEvent({
      spaceId: 'space_1',
      model: 'gpt-5-mini',
      inputTokens: 10,
      outputTokens: 10,
    });
    expect(insertedRows[0].department).toBeNull();
  });

  it('does not throw when the insert fails', async () => {
    nextInsertError = { message: 'connection refused' };
    await expect(
      emitCostEvent({ spaceId: 'space_1', model: 'gpt-5-mini' }),
    ).resolves.toBeUndefined();
    expect(insertedRows).toHaveLength(0);
  });

  it('does not throw when supabase itself throws', async () => {
    // Simulate by passing in a malformed spaceId path — actually we just
    // override the mock to throw synchronously.
    const original = (await import('@/lib/supabase')).supabase.from;
    (await import('@/lib/supabase')).supabase.from = (() => {
      throw new Error('boom');
    }) as typeof original;
    try {
      await expect(
        emitCostEvent({ spaceId: 'space_1', model: 'gpt-5-mini' }),
      ).resolves.toBeUndefined();
    } finally {
      (await import('@/lib/supabase')).supabase.from = original;
    }
  });

  it('skips insert when spaceId is missing', async () => {
    await emitCostEvent({ spaceId: '', model: 'gpt-5-mini' });
    expect(insertedRows).toHaveLength(0);
  });

  it('skips insert when model is missing', async () => {
    await emitCostEvent({ spaceId: 'space_1', model: '' });
    expect(insertedRows).toHaveLength(0);
  });

  it('defaults inputTokens/outputTokens to 0 when omitted', async () => {
    await emitCostEvent({
      spaceId: 'space_1',
      model: 'gpt-5-mini',
    });
    expect(insertedRows[0]).toMatchObject({
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
    });
  });
});

// ── loadRollup ──
describe('loadRollup', () => {
  it('returns [] when no spaceId is provided', async () => {
    const rows = await loadRollup('');
    expect(rows).toEqual([]);
    expect(rpcCalls).toHaveLength(0);
  });

  it('calls the rollup SQL function with the right args', async () => {
    await loadRollup('space_1', 14);
    expect(rpcCalls[0]).toEqual({
      fn: 'rollup_cost_by_day',
      args: { p_space_id: 'space_1', p_days: 14 },
    });
  });

  it('defaults to 30 days', async () => {
    await loadRollup('space_1');
    expect(rpcCalls[0].args).toMatchObject({ p_days: 30 });
  });

  it('transforms snake_case RPC rows into camelCase RollupRow', async () => {
    nextRpcResult = {
      data: [
        {
          day: '2026-05-12',
          department: 'engineering',
          model: 'gpt-5-mini',
          total_input: '1234',
          total_output: '567',
          total_cost: '0.012345',
        },
      ],
      error: null,
    };
    const rows = await loadRollup('space_1');
    expect(rows).toEqual([
      {
        day: '2026-05-12',
        department: 'engineering',
        model: 'gpt-5-mini',
        totalInputTokens: 1234,
        totalOutputTokens: 567,
        totalCostUsd: 0.012345,
      },
    ]);
  });

  it('coerces null department to in_process', async () => {
    nextRpcResult = {
      data: [
        {
          day: '2026-05-12',
          department: null,
          model: 'gpt-4o-mini',
          total_input: 0,
          total_output: 0,
          total_cost: 0,
        },
      ],
      error: null,
    };
    const rows = await loadRollup('space_1');
    expect(rows[0].department).toBe('in_process');
  });

  it('truncates ISO timestamps to YYYY-MM-DD', async () => {
    nextRpcResult = {
      data: [
        {
          day: '2026-05-12T00:00:00.000Z',
          department: 'manager',
          model: 'gpt-5',
          total_input: 0,
          total_output: 0,
          total_cost: 0,
        },
      ],
      error: null,
    };
    const rows = await loadRollup('space_1');
    expect(rows[0].day).toBe('2026-05-12');
  });

  it('returns [] when the RPC returns an error', async () => {
    nextRpcResult = { data: null, error: { message: 'function not found' } };
    const rows = await loadRollup('space_1');
    expect(rows).toEqual([]);
  });

  it('returns [] when the RPC returns null data', async () => {
    nextRpcResult = { data: null, error: null };
    const rows = await loadRollup('space_1');
    expect(rows).toEqual([]);
  });
});
