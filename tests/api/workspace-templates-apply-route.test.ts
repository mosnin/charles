/**
 * Route-level tests for `POST /api/workspace-templates/apply`.
 *
 * Pins:
 *   - 401 unauthenticated, 403 no space, 400 unknown template.
 *   - 200 happy path seeds mission/core-memory/gates/docs.
 *   - Mission fields are NOT overwritten when already set.
 *   - Document seeds are NOT overwritten when content is non-empty.
 *   - Re-applying the same template is idempotent on extra gates.
 *   - Rate limit kicks in after 4 applies per space per day.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextResponse } from 'next/server';

vi.mock('@/lib/api-auth', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('@/lib/space', () => ({
  getSpaceForUser: vi.fn(),
}));

// Per-table queues + per-verb spies. Each `.from(table)` shifts the next
// queued terminal off the table's queue. Tests push expected return values
// before calling the handler.
const { tableQueues, updateSpy, upsertSpy, insertSpy } = vi.hoisted(() => ({
  tableQueues: {
    Mission: [] as Array<{ data?: unknown; error?: unknown }>,
    CoreMemory: [] as Array<{ data?: unknown; error?: unknown }>,
    StageGate: [] as Array<{ data?: unknown; error?: unknown }>,
    Document: [] as Array<{ data?: unknown; error?: unknown }>,
  },
  updateSpy: vi.fn(),
  upsertSpy: vi.fn(),
  insertSpy: vi.fn(),
}));

vi.mock('@/lib/supabase', () => {
  function chain(table: string) {
    const queue = tableQueues[table as keyof typeof tableQueues];
    const terminal = queue?.shift() ?? { data: null, error: null };
    const obj: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'in', 'order', 'limit']) {
      obj[m] = vi.fn(() => obj);
    }
    obj.maybeSingle = vi.fn(() => Promise.resolve(terminal));
    obj.single = vi.fn(() => Promise.resolve(terminal));
    // For .select().eq()... that resolves to a list, we make the chain
    // thenable so `await` works.
    (obj as { then?: unknown }).then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve(terminal).then(resolve);
    obj.update = vi.fn((payload: Record<string, unknown>) => {
      updateSpy({ table, payload });
      const upd: Record<string, unknown> = {};
      upd.eq = vi.fn(() => upd);
      (upd as { then?: unknown }).then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: null, error: null }).then(resolve);
      return upd;
    });
    obj.insert = vi.fn((payload: unknown) => {
      insertSpy({ table, payload });
      return Promise.resolve({ data: null, error: null });
    });
    obj.upsert = vi.fn((payload: unknown, opts?: unknown) => {
      upsertSpy({ table, payload, opts });
      return Promise.resolve({ data: null, error: null });
    });
    return obj;
  }
  return { supabase: { from: vi.fn((table: string) => chain(table)) } };
});

import { POST } from '@/app/api/workspace-templates/apply/route';
import { __resetApplyBucketForTests } from '@/lib/workspace-templates/rate-limit';
import { requireAuth } from '@/lib/api-auth';
import { getSpaceForUser } from '@/lib/space';

const mockAuth = vi.mocked(requireAuth);
const mockGetSpace = vi.mocked(getSpaceForUser);

const SPACE = {
  id: 'space_1',
  slug: 'jane',
  name: 'Jane Co',
  emoji: null,
  ownerId: 'user_db_1',
  brokerageId: null,
  createdAt: '2026-04-01T00:00:00.000Z',
} as unknown as NonNullable<Awaited<ReturnType<typeof getSpaceForUser>>>;

function makeReq(body: unknown): Request {
  return new Request('http://localhost/api/workspace-templates/apply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function pushHappyPathDefaults(opts?: {
  missionExisting?: Record<string, string | null>;
  existingGates?: Array<{ stage: string; title: string }>;
  filledDocs?: Array<{ slug: string; content: string }>;
}) {
  // 1. Mission select (in applyMission)
  tableQueues.Mission.push({
    data: opts?.missionExisting ?? {
      title: '',
      description: '',
      oneLinePitch: '',
      targetCustomer: '',
    },
    error: null,
  });
  // 2. CoreMemory has no select before upsert — skip.
  // 3. StageGate select existing pairs
  tableQueues.StageGate.push({
    data: opts?.existingGates ?? [],
    error: null,
  });
  // 4. Document select for filled set
  tableQueues.Document.push({
    data: opts?.filledDocs ?? [],
    error: null,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  tableQueues.Mission.length = 0;
  tableQueues.CoreMemory.length = 0;
  tableQueues.StageGate.length = 0;
  tableQueues.Document.length = 0;
  mockAuth.mockResolvedValue({ userId: 'user_clerk_1' });
  mockGetSpace.mockResolvedValue(SPACE);
  __resetApplyBucketForTests();
});

describe('POST /api/workspace-templates/apply', () => {
  it('401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    );
    const res = await POST(makeReq({ templateSlug: 'saas-b2b' }) as Parameters<typeof POST>[0]);
    expect(res.status).toBe(401);
  });

  it('400 when JSON body is malformed', async () => {
    const res = await POST(makeReq('{not-json') as Parameters<typeof POST>[0]);
    expect(res.status).toBe(400);
  });

  it('400 when templateSlug is missing', async () => {
    const res = await POST(makeReq({}) as Parameters<typeof POST>[0]);
    expect(res.status).toBe(400);
  });

  it('400 when templateSlug is unknown', async () => {
    const res = await POST(
      makeReq({ templateSlug: 'crypto-cult' }) as Parameters<typeof POST>[0],
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/template/i);
  });

  it('403 when caller has no workspace', async () => {
    mockGetSpace.mockResolvedValue(null);
    const res = await POST(
      makeReq({ templateSlug: 'saas-b2b' }) as Parameters<typeof POST>[0],
    );
    expect(res.status).toBe(403);
  });

  it('200 happy path seeds everything', async () => {
    pushHappyPathDefaults();
    const res = await POST(
      makeReq({ templateSlug: 'saas-b2b' }) as Parameters<typeof POST>[0],
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.applied).toBe(true);
    expect(body.updatedMission).toBe(true);
    expect(body.addedGates).toBeGreaterThan(0);
    expect(body.addedDocs).toBeGreaterThan(0);

    // Mission update happened
    expect(
      updateSpy.mock.calls.some((c) => (c[0] as { table: string }).table === 'Mission'),
    ).toBe(true);
    // CoreMemory upsert happened
    expect(
      upsertSpy.mock.calls.some((c) => (c[0] as { table: string }).table === 'CoreMemory'),
    ).toBe(true);
    // StageGate insert happened
    expect(
      insertSpy.mock.calls.some((c) => (c[0] as { table: string }).table === 'StageGate'),
    ).toBe(true);
    // Document upsert happened
    expect(
      upsertSpy.mock.calls.some((c) => (c[0] as { table: string }).table === 'Document'),
    ).toBe(true);
  });

  it('does NOT overwrite mission fields that are already set', async () => {
    pushHappyPathDefaults({
      missionExisting: {
        title: 'Acme',
        description: 'Already filled in by founder.',
        oneLinePitch: 'Founder wrote this.',
        targetCustomer: 'Founder picked these humans.',
      },
    });
    const res = await POST(
      makeReq({ templateSlug: 'saas-b2b' }) as Parameters<typeof POST>[0],
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.updatedMission).toBe(false);

    // No mission update should fire when every field is non-empty.
    const missionUpdates = updateSpy.mock.calls.filter(
      (c) => (c[0] as { table: string }).table === 'Mission',
    );
    expect(missionUpdates).toHaveLength(0);
  });

  it('fills only the empty mission fields and leaves the rest', async () => {
    pushHappyPathDefaults({
      missionExisting: {
        title: 'Acme',
        description: '',
        oneLinePitch: '',
        targetCustomer: 'Founder picked these humans.',
      },
    });
    const res = await POST(
      makeReq({ templateSlug: 'saas-b2b' }) as Parameters<typeof POST>[0],
    );
    expect(res.status).toBe(200);

    const missionCall = updateSpy.mock.calls.find(
      (c) => (c[0] as { table: string }).table === 'Mission',
    );
    expect(missionCall).toBeTruthy();
    const payload = (missionCall![0] as { payload: Record<string, unknown> })
      .payload;
    // The two empty fields get filled, the populated ones stay untouched.
    expect(payload.description).toBeTruthy();
    expect(payload.oneLinePitch).toBeTruthy();
    expect(payload.title).toBeUndefined();
    expect(payload.targetCustomer).toBeUndefined();
  });

  it('does NOT overwrite documents that already have content', async () => {
    pushHappyPathDefaults({
      filledDocs: [
        { slug: 'brand-kit', content: '# Founder wrote this' },
        { slug: 'sales-plan', content: 'Mine. Hands off.' },
        { slug: 'marketing-plan', content: 'Also mine.' },
      ],
    });
    const res = await POST(
      makeReq({ templateSlug: 'saas-b2b' }) as Parameters<typeof POST>[0],
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.addedDocs).toBe(0);

    const docUpserts = upsertSpy.mock.calls.filter(
      (c) => (c[0] as { table: string }).table === 'Document',
    );
    expect(docUpserts).toHaveLength(0);
  });

  it('treats whitespace-only documents as empty (will overwrite)', async () => {
    pushHappyPathDefaults({
      filledDocs: [{ slug: 'brand-kit', content: '   \n\t  ' }],
    });
    const res = await POST(
      makeReq({ templateSlug: 'saas-b2b' }) as Parameters<typeof POST>[0],
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.addedDocs).toBeGreaterThan(0);
  });

  it('skips gates that already exist for the (stage, title) pair', async () => {
    // saas-b2b has 4 extra gates total. Pre-populate two of them.
    pushHappyPathDefaults({
      existingGates: [
        { stage: 'idea', title: 'Define your ICP' },
        { stage: 'initial', title: 'Set up free trial' },
      ],
    });
    const res = await POST(
      makeReq({ templateSlug: 'saas-b2b' }) as Parameters<typeof POST>[0],
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    // saas-b2b ships 4 extra gates total; 2 already existed → 2 remaining.
    expect(body.addedGates).toBe(2);

    const gateInsert = insertSpy.mock.calls.find(
      (c) => (c[0] as { table: string }).table === 'StageGate',
    );
    expect(gateInsert).toBeTruthy();
    const inserted = (gateInsert![0] as { payload: Array<{ title: string }> })
      .payload;
    const titles = inserted.map((g) => g.title);
    expect(titles).not.toContain('Define your ICP');
    expect(titles).not.toContain('Set up free trial');
  });

  it('is idempotent: re-apply with all gates already present inserts nothing', async () => {
    pushHappyPathDefaults({
      existingGates: [
        { stage: 'idea', title: 'Define your ICP' },
        { stage: 'initial', title: 'Set up free trial' },
        { stage: 'selling', title: 'Publish pricing page' },
        { stage: 'selling', title: 'First paying logo' },
      ],
    });
    const res = await POST(
      makeReq({ templateSlug: 'saas-b2b' }) as Parameters<typeof POST>[0],
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.addedGates).toBe(0);

    const gateInserts = insertSpy.mock.calls.filter(
      (c) => (c[0] as { table: string }).table === 'StageGate',
    );
    expect(gateInserts).toHaveLength(0);
  });

  it('429 after 4 applies in the same day', async () => {
    for (let i = 0; i < 4; i++) {
      pushHappyPathDefaults();
      const ok = await POST(
        makeReq({ templateSlug: 'saas-b2b' }) as Parameters<typeof POST>[0],
      );
      expect(ok.status).toBe(200);
    }
    const blocked = await POST(
      makeReq({ templateSlug: 'saas-b2b' }) as Parameters<typeof POST>[0],
    );
    expect(blocked.status).toBe(429);
  });

  it('applies physical-product template end-to-end', async () => {
    pushHappyPathDefaults();
    const res = await POST(
      makeReq({ templateSlug: 'physical-product' }) as Parameters<typeof POST>[0],
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.applied).toBe(true);
    expect(body.addedGates).toBeGreaterThan(0);
  });

  it('CoreMemory upsert payload uses (spaceId, slot) onConflict', async () => {
    pushHappyPathDefaults();
    await POST(
      makeReq({ templateSlug: 'saas-b2b' }) as Parameters<typeof POST>[0],
    );
    const cmCall = upsertSpy.mock.calls.find(
      (c) => (c[0] as { table: string }).table === 'CoreMemory',
    );
    expect(cmCall).toBeTruthy();
    const opts = (cmCall![0] as { opts?: { onConflict?: string } }).opts;
    expect(opts?.onConflict).toBe('spaceId,slot');
  });
});
