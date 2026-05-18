/**
 * Tests for lib/departments/autonomy.ts.
 *
 * The contract this file enforces:
 *   - getDepartmentAutonomy returns DEFAULT_AUTONOMY when no row exists.
 *     The runtime calls this before every mutating tool; a missing seed
 *     row must NOT crash a run.
 *   - getAllDepartmentAutonomy always returns a complete 6-entry record,
 *     filling missing rows with the default.
 *   - setDepartmentAutonomy upserts (insert-or-update) so callers don't
 *     have to know whether onboarding ran.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock supabase: a tiny in-memory shim that supports the chains we use ──
type Row = { spaceId: string; slug: string; autonomyLevel: string; name?: string };
let rows: Row[] = [];
let nextUpsertError: { message: string } | null = null;
const upsertCalls: Array<{ row: Row; opts: unknown }> = [];

function makeSingleResult(filtered: Row[], fields: string) {
  const requested = fields.split(',').map((f) => f.trim());
  const r = filtered[0];
  if (!r) return { data: null, error: null };
  const projected: Record<string, unknown> = {};
  for (const f of requested) projected[f] = (r as unknown as Record<string, unknown>)[f];
  return { data: projected, error: null };
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (_table: string) => {
      let selectFields = '*';
      const filters: Array<(r: Row) => boolean> = [];
      const builder = {
        select(fields: string) {
          selectFields = fields;
          return builder;
        },
        eq(col: keyof Row, val: string) {
          filters.push((r) => r[col] === val);
          return builder;
        },
        maybeSingle() {
          const filtered = rows.filter((r) => filters.every((f) => f(r)));
          return Promise.resolve(makeSingleResult(filtered, selectFields));
        },
        // Plain `select().eq()` (no .maybeSingle) — used by the list helper.
        // We give it a `then` so `await` resolves to the rows array.
        then(onFulfilled: (v: { data: Row[]; error: null }) => unknown) {
          const filtered = rows.filter((r) => filters.every((f) => f(r)));
          const requested = selectFields.split(',').map((f) => f.trim());
          const projected = filtered.map((r) => {
            const obj: Record<string, unknown> = {};
            for (const f of requested) obj[f] = (r as unknown as Record<string, unknown>)[f];
            return obj;
          });
          return Promise.resolve(onFulfilled({ data: projected as Row[], error: null }));
        },
        upsert(row: Row, opts: unknown) {
          upsertCalls.push({ row, opts });
          if (nextUpsertError) {
            return Promise.resolve({ data: null, error: nextUpsertError });
          }
          const idx = rows.findIndex(
            (r) => r.spaceId === row.spaceId && r.slug === row.slug,
          );
          if (idx >= 0) rows[idx] = { ...rows[idx], ...row };
          else rows.push(row);
          return Promise.resolve({ data: null, error: null });
        },
      };
      return builder;
    },
  },
}));

import {
  ALL_DEPARTMENTS,
  AUTONOMY_LEVELS,
  DEFAULT_AUTONOMY,
  DEPARTMENT_NAMES,
  getAllDepartmentAutonomy,
  getDepartmentAutonomy,
  isAutonomyLevel,
  isDepartmentSlug,
  setDepartmentAutonomy,
} from '@/lib/departments/autonomy';

beforeEach(() => {
  rows = [];
  nextUpsertError = null;
  upsertCalls.length = 0;
});

describe('constants', () => {
  it('has exactly 6 known departments in the documented order', () => {
    expect(ALL_DEPARTMENTS).toEqual([
      'engineering',
      'design',
      'marketing',
      'sales',
      'support',
      'ops_finance',
    ]);
  });

  it('has exactly 4 autonomy levels', () => {
    expect(AUTONOMY_LEVELS).toEqual(['observe', 'ask', 'auto-low', 'autonomous']);
  });

  it('default autonomy is ask — the safe-by-default contract', () => {
    expect(DEFAULT_AUTONOMY).toBe('ask');
  });

  it('every department has a human-readable name', () => {
    for (const slug of ALL_DEPARTMENTS) {
      expect(DEPARTMENT_NAMES[slug]).toBeTruthy();
    }
  });
});

describe('isAutonomyLevel / isDepartmentSlug', () => {
  it('isAutonomyLevel accepts valid levels and rejects everything else', () => {
    expect(isAutonomyLevel('ask')).toBe(true);
    expect(isAutonomyLevel('autonomous')).toBe(true);
    expect(isAutonomyLevel('AUTO-LOW')).toBe(false);
    expect(isAutonomyLevel('full-send')).toBe(false);
    expect(isAutonomyLevel(null)).toBe(false);
    expect(isAutonomyLevel(undefined)).toBe(false);
    expect(isAutonomyLevel(42)).toBe(false);
  });

  it('isDepartmentSlug accepts the 6 known slugs and rejects others', () => {
    expect(isDepartmentSlug('engineering')).toBe(true);
    expect(isDepartmentSlug('ops_finance')).toBe(true);
    expect(isDepartmentSlug('legal')).toBe(false);
    expect(isDepartmentSlug('Engineering')).toBe(false);
    expect(isDepartmentSlug('')).toBe(false);
  });
});

describe('getDepartmentAutonomy', () => {
  it('returns the default (ask) when no row exists — never throws on missing', async () => {
    const lvl = await getDepartmentAutonomy('space_1', 'engineering');
    expect(lvl).toBe('ask');
  });

  it('returns the persisted value when the row exists', async () => {
    rows.push({ spaceId: 'space_1', slug: 'support', autonomyLevel: 'auto-low' });
    const lvl = await getDepartmentAutonomy('space_1', 'support');
    expect(lvl).toBe('auto-low');
  });

  it('does not return rows from a different space', async () => {
    rows.push({ spaceId: 'space_OTHER', slug: 'sales', autonomyLevel: 'autonomous' });
    const lvl = await getDepartmentAutonomy('space_1', 'sales');
    expect(lvl).toBe('ask');
  });

  it('falls back to default when the row has a corrupt/legacy level', async () => {
    rows.push({ spaceId: 'space_1', slug: 'marketing', autonomyLevel: 'wild-west' });
    const lvl = await getDepartmentAutonomy('space_1', 'marketing');
    expect(lvl).toBe('ask');
  });
});

describe('getAllDepartmentAutonomy', () => {
  it('returns a complete 6-entry record when no rows exist', async () => {
    const all = await getAllDepartmentAutonomy('space_1');
    for (const slug of ALL_DEPARTMENTS) {
      expect(all[slug]).toBe('ask');
    }
  });

  it('merges persisted rows on top of defaults', async () => {
    rows.push(
      { spaceId: 'space_1', slug: 'engineering', autonomyLevel: 'observe' },
      { spaceId: 'space_1', slug: 'support', autonomyLevel: 'auto-low' },
    );
    const all = await getAllDepartmentAutonomy('space_1');
    expect(all.engineering).toBe('observe');
    expect(all.support).toBe('auto-low');
    // Unset departments still come back as the default.
    expect(all.design).toBe('ask');
    expect(all.ops_finance).toBe('ask');
  });
});

describe('setDepartmentAutonomy', () => {
  it('persists a new value (insert path)', async () => {
    await setDepartmentAutonomy('space_1', 'design', 'autonomous');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      spaceId: 'space_1',
      slug: 'design',
      autonomyLevel: 'autonomous',
    });
    // Round-trips through the read path.
    expect(await getDepartmentAutonomy('space_1', 'design')).toBe('autonomous');
  });

  it('updates the existing row (upsert path)', async () => {
    rows.push({ spaceId: 'space_1', slug: 'sales', autonomyLevel: 'ask' });
    await setDepartmentAutonomy('space_1', 'sales', 'autonomous');
    expect(rows).toHaveLength(1);
    expect(rows[0].autonomyLevel).toBe('autonomous');
  });

  it('upserts on (spaceId, slug) — the unique key the migration declared', async () => {
    await setDepartmentAutonomy('space_1', 'engineering', 'observe');
    expect(upsertCalls[0].opts).toMatchObject({ onConflict: 'spaceId,slug' });
  });

  it('throws on DB error so the API can surface a 500', async () => {
    nextUpsertError = { message: 'connection refused' };
    await expect(
      setDepartmentAutonomy('space_1', 'engineering', 'autonomous'),
    ).rejects.toThrow(/connection refused/);
  });
});
