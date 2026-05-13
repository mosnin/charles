/**
 * Route-level tests for `POST /api/onboarding/complete`.
 *
 * Pins the 10-screen wizard contract:
 *   - Validates the new founder-profile fields (stage, role, technicalExperience).
 *   - Persists them onto Mission as ideaStage / founderRole / technicalExperience.
 *   - Resolves the effective workspace template slug (explicit > auto-pick from
 *     stage > default), returned in the JSON response.
 *   - Stays backwards-compatible with the old payload shape.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextResponse } from 'next/server';

vi.mock('@/lib/api-auth', () => ({
  requireAuth: vi.fn(),
}));

const { tableQueues, updateSpy, upsertSpy, rpcSpy } = vi.hoisted(() => ({
  tableQueues: {
    User: [] as Array<{ data?: unknown; error?: unknown }>,
    Space: [] as Array<{ data?: unknown; error?: unknown }>,
    Mission: [] as Array<{ data?: unknown; error?: unknown }>,
    CoreMemory: [] as Array<{ data?: unknown; error?: unknown }>,
  },
  updateSpy: vi.fn(),
  upsertSpy: vi.fn(),
  rpcSpy: vi.fn(),
}));

vi.mock('@/lib/supabase', () => {
  function chain(table: string) {
    const queue = tableQueues[table as keyof typeof tableQueues];
    const obj: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'in', 'order', 'limit']) {
      obj[m] = vi.fn(() => obj);
    }
    obj.maybeSingle = vi.fn(() => {
      const terminal = queue?.shift() ?? { data: null, error: null };
      return Promise.resolve(terminal);
    });
    obj.single = vi.fn(() => {
      const terminal = queue?.shift() ?? { data: null, error: null };
      return Promise.resolve(terminal);
    });
    obj.update = vi.fn((payload: Record<string, unknown>) => {
      updateSpy({ table, payload });
      const upd: Record<string, unknown> = {};
      upd.eq = vi.fn(() => upd);
      (upd as { then?: unknown }).then = (
        resolve: (v: unknown) => unknown,
      ) => Promise.resolve({ data: null, error: null }).then(resolve);
      return upd;
    });
    obj.upsert = vi.fn((payload: unknown, opts?: unknown) => {
      upsertSpy({ table, payload, opts });
      return Promise.resolve({ data: null, error: null });
    });
    return obj;
  }
  return {
    supabase: {
      from: vi.fn((table: string) => chain(table)),
      rpc: vi.fn((name: string, args: unknown) => {
        rpcSpy({ name, args });
        return Promise.resolve({ data: null, error: null });
      }),
    },
  };
});

import { POST } from '@/app/api/onboarding/complete/route';
import { requireAuth } from '@/lib/api-auth';

const mockAuth = vi.mocked(requireAuth);

function makeReq(body: unknown): Request {
  return new Request('http://localhost/api/onboarding/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function primeHappyPath() {
  // User select
  tableQueues.User.push({
    data: { id: 'user_db_1', name: null, onboard: false },
    error: null,
  });
  // Space select
  tableQueues.Space.push({
    data: { id: 'space_1', slug: 'jane' },
    error: null,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  tableQueues.User.length = 0;
  tableQueues.Space.length = 0;
  tableQueues.Mission.length = 0;
  tableQueues.CoreMemory.length = 0;
  mockAuth.mockResolvedValue({ userId: 'user_clerk_1' });
});

describe('POST /api/onboarding/complete — auth & shape', () => {
  it('401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    );
    const res = await POST(
      makeReq({ companyName: 'Acme' }) as Parameters<typeof POST>[0],
    );
    expect(res.status).toBe(401);
  });

  it('400 when JSON body is malformed', async () => {
    const res = await POST(makeReq('{not-json') as Parameters<typeof POST>[0]);
    expect(res.status).toBe(400);
  });
});

describe('POST /api/onboarding/complete — new founder-profile fields', () => {
  it('accepts the new shape (stage/role/technicalExperience) and persists onto Mission', async () => {
    primeHappyPath();
    const res = await POST(
      makeReq({
        companyName: 'Acme',
        founderName: 'Jane',
        whatBuilding: 'A thing.',
        targetCustomer: 'Founders.',
        stage: 'mvp',
        role: 'engineering',
        technicalExperience: 'writes-code',
      }) as Parameters<typeof POST>[0],
    );
    expect(res.status).toBe(200);

    const missionUpdate = updateSpy.mock.calls
      .map(([c]) => c)
      .find((c) => c.table === 'Mission');
    expect(missionUpdate).toBeDefined();
    expect(missionUpdate.payload.ideaStage).toBe('mvp');
    expect(missionUpdate.payload.founderRole).toBe('engineering');
    expect(missionUpdate.payload.technicalExperience).toBe('writes-code');
  });

  it('400 on invalid stage', async () => {
    const res = await POST(
      makeReq({ stage: 'unicorn' }) as Parameters<typeof POST>[0],
    );
    expect(res.status).toBe(400);
  });

  it('400 on invalid role', async () => {
    const res = await POST(
      makeReq({ role: 'philosopher' }) as Parameters<typeof POST>[0],
    );
    expect(res.status).toBe(400);
  });

  it('400 on invalid technicalExperience', async () => {
    const res = await POST(
      makeReq({
        technicalExperience: 'wizard',
      }) as Parameters<typeof POST>[0],
    );
    expect(res.status).toBe(400);
  });

  it('400 on invalid templateSlug', async () => {
    const res = await POST(
      makeReq({ templateSlug: 'crypto-cult' }) as Parameters<typeof POST>[0],
    );
    expect(res.status).toBe(400);
  });

  it('accepts each valid stage', async () => {
    const stages = [
      'pre-idea',
      'idea',
      'pre-mvp',
      'mvp',
      'customers',
      'revenue',
      'public',
    ];
    for (const stage of stages) {
      tableQueues.User.length = 0;
      tableQueues.Space.length = 0;
      primeHappyPath();
      const res = await POST(
        makeReq({ stage }) as Parameters<typeof POST>[0],
      );
      expect(res.status).toBe(200);
    }
  });

  it('accepts each valid role', async () => {
    const roles = [
      'product',
      'engineering',
      'design',
      'marketing',
      'sales',
      'operations',
      'founder',
      'other',
    ];
    for (const role of roles) {
      tableQueues.User.length = 0;
      tableQueues.Space.length = 0;
      primeHappyPath();
      const res = await POST(
        makeReq({ role }) as Parameters<typeof POST>[0],
      );
      expect(res.status).toBe(200);
    }
  });

  it('accepts each valid technicalExperience', async () => {
    const exps = ['writes-code', 'manages-engineers', 'non-technical'];
    for (const technicalExperience of exps) {
      tableQueues.User.length = 0;
      tableQueues.Space.length = 0;
      primeHappyPath();
      const res = await POST(
        makeReq({ technicalExperience }) as Parameters<typeof POST>[0],
      );
      expect(res.status).toBe(200);
    }
  });
});

describe('POST /api/onboarding/complete — back-compat', () => {
  it('accepts the old shape (no new fields) and Mission row gets no new columns', async () => {
    primeHappyPath();
    const res = await POST(
      makeReq({
        companyName: 'OldCo',
        tagline: 'We do things.',
        founderName: 'Jane',
        whatBuilding: 'Stuff.',
        oneLinePitch: 'Stuff for people.',
        targetCustomer: 'People.',
        githubConnected: true,
      }) as Parameters<typeof POST>[0],
    );
    expect(res.status).toBe(200);
    const missionUpdate = updateSpy.mock.calls
      .map(([c]) => c)
      .find((c) => c.table === 'Mission');
    expect(missionUpdate).toBeDefined();
    expect(missionUpdate.payload.ideaStage).toBeUndefined();
    expect(missionUpdate.payload.founderRole).toBeUndefined();
    expect(missionUpdate.payload.technicalExperience).toBeUndefined();
  });

  it('still accepts tagline + oneLinePitch (old wizard pass-through)', async () => {
    primeHappyPath();
    const res = await POST(
      makeReq({
        companyName: 'Acme',
        tagline: 'Just a tag.',
        oneLinePitch: 'A pitch.',
      }) as Parameters<typeof POST>[0],
    );
    expect(res.status).toBe(200);
  });

  it('still returns success + slug', async () => {
    primeHappyPath();
    const res = await POST(
      makeReq({ companyName: 'Acme' }) as Parameters<typeof POST>[0],
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.slug).toBe('jane');
  });
});

describe('POST /api/onboarding/complete — template auto-pick', () => {
  it('returns auto-picked templateSlug when only stage is present', async () => {
    primeHappyPath();
    const res = await POST(
      makeReq({ stage: 'mvp' }) as Parameters<typeof POST>[0],
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.appliedTemplateSlug).toBe('saas-b2b');
  });

  it('respects explicit templateSlug (caller override wins)', async () => {
    primeHappyPath();
    const res = await POST(
      makeReq({
        stage: 'mvp',
        templateSlug: 'physical-product',
      }) as Parameters<typeof POST>[0],
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.appliedTemplateSlug).toBe('physical-product');
  });

  it('falls back to default when neither stage nor templateSlug is present', async () => {
    primeHappyPath();
    const res = await POST(
      makeReq({ companyName: 'Acme' }) as Parameters<typeof POST>[0],
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.appliedTemplateSlug).toBe('saas-b2b');
  });

  it('uses templateSlug when stage is absent', async () => {
    primeHappyPath();
    const res = await POST(
      makeReq({ templateSlug: 'b2b-agency' }) as Parameters<typeof POST>[0],
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.appliedTemplateSlug).toBe('b2b-agency');
  });
});

describe('POST /api/onboarding/complete — persistence side-effects', () => {
  it('writes founder-profile fields into CoreMemory slots', async () => {
    primeHappyPath();
    await POST(
      makeReq({
        stage: 'idea',
        role: 'product',
        technicalExperience: 'non-technical',
      }) as Parameters<typeof POST>[0],
    );
    const coreMemoryUpsert = upsertSpy.mock.calls
      .map(([c]) => c)
      .find((c) => c.table === 'CoreMemory');
    expect(coreMemoryUpsert).toBeDefined();
    const slots = coreMemoryUpsert.payload as Array<{
      slot: string;
      value: string;
    }>;
    const get = (k: string) => slots.find((s) => s.slot === k)?.value;
    expect(get('idea_stage')).toBe('idea');
    expect(get('founder_role')).toBe('product');
    expect(get('technical_experience')).toBe('non-technical');
  });

  it('marks the user as onboarded', async () => {
    primeHappyPath();
    await POST(
      makeReq({ companyName: 'Acme' }) as Parameters<typeof POST>[0],
    );
    const userUpdates = updateSpy.mock.calls
      .map(([c]) => c)
      .filter((c) => c.table === 'User');
    const onboard = userUpdates.find(
      (c) => (c.payload as Record<string, unknown>).onboard === true,
    );
    expect(onboard).toBeDefined();
  });
});
