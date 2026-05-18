/**
 * Tests for GET /api/cron/trigger-fanout.
 *
 * The route does three things — scheduled-trigger fanout, heartbeat
 * tick, Modal wake-up dedupe. Tests cover each path in isolation by
 * mocking the repo, the supabase AgentSettings reads, the redis push,
 * and fetch().
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mocks ──────────────────────────────────────────────────────────────

const listReadyMock = vi.fn();
const markFiredMock = vi.fn();
vi.mock('@/lib/triggers/scheduled-trigger-repo', () => ({
  listReadyTriggers: (...a: unknown[]) => listReadyMock(...a),
  markTriggerFired: (...a: unknown[]) => markFiredMock(...a),
}));

const rpushMock = vi.fn(async (_key: string, _val: string) => 1);
vi.mock('@/lib/redis', () => ({ redis: { rpush: rpushMock } }));

let enabledSpacesResult: { data?: unknown; error?: unknown } = { data: [], error: null };
const supabaseUpdateMock = vi.fn();
vi.mock('@/lib/supabase', () => {
  const fromMock = vi.fn((_table: string) => {
    const chain: Record<string, unknown> = {};
    const passthroughs = ['select', 'eq', 'update'];
    for (const m of passthroughs) chain[m] = vi.fn(() => chain);
    chain.update = vi.fn((vals: Record<string, unknown>) => {
      supabaseUpdateMock(vals);
      return chain;
    });
    chain.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve(enabledSpacesResult).then(resolve);
    return chain;
  });
  return { supabase: { from: fromMock } };
});

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const fetchMock = vi.fn();
const realFetch = globalThis.fetch;
beforeEach(() => {
  vi.clearAllMocks();
  enabledSpacesResult = { data: [], error: null };
  listReadyMock.mockResolvedValue([]);
  markFiredMock.mockResolvedValue(undefined);
  process.env.CRON_SECRET = 'tk';
  process.env.MODAL_WEBHOOK_URL = 'https://modal.test/wake';
  process.env.AGENT_INTERNAL_SECRET = 'agent_secret';
  delete process.env.CRON_TRIGGER_FANOUT_DISABLED;
  fetchMock.mockResolvedValue({ ok: true, text: async () => '' });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

async function callRoute(headers: Record<string, string> = {}) {
  const { GET } = await import('@/app/api/cron/trigger-fanout/route');
  const req = new Request('https://localhost/api/cron/trigger-fanout', {
    headers: {
      authorization: 'Bearer tk',
      ...headers,
    },
  });
  return GET(req as unknown as import('next/server').NextRequest);
}

afterAll(() => {
  globalThis.fetch = realFetch;
});

import { afterAll } from 'vitest';

// ── Auth + kill-switch ─────────────────────────────────────────────────

describe('auth + kill-switch', () => {
  it('rejects missing auth', async () => {
    const res = await callRoute({ authorization: 'wrong' });
    expect(res.status).toBe(401);
  });

  it('returns ok with skipped when kill-switch is on', async () => {
    process.env.CRON_TRIGGER_FANOUT_DISABLED = 'true';
    const res = await callRoute();
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.skipped).toMatch(/kill-switch/);
    expect(listReadyMock).not.toHaveBeenCalled();
  });
});

// ── Scheduled-trigger fanout ───────────────────────────────────────────

describe('scheduled-trigger fanout', () => {
  it('fires each ready trigger and pushes to redis', async () => {
    listReadyMock.mockResolvedValue([
      {
        id: 't_1',
        spaceId: 'sp_1',
        runAt: '2026-05-17T12:00:00Z',
        reason: 'check pr',
        payload: { pr: 42 },
        source: 'agent',
        status: 'pending',
        firedAt: null,
        cancelledAt: null,
        createdAt: '2026-05-16T00:00:00Z',
        createdByTaskId: null,
      },
    ]);
    const res = await callRoute();
    const body = await res.json();
    expect(body.scheduledFired).toBe(1);
    expect(markFiredMock).toHaveBeenCalledWith('t_1');
    expect(rpushMock).toHaveBeenCalledTimes(1);
    const firstCall = rpushMock.mock.calls[0]!;
    expect(firstCall[0]).toBe('agent:triggers:sp_1');
    const parsed = JSON.parse(firstCall[1]);
    expect(parsed.event).toBe('scheduled_wake');
    expect(parsed.triggerId).toBe('t_1');
    expect(parsed.reason).toBe('check pr');
  });

  it('isolates per-trigger failures', async () => {
    listReadyMock.mockResolvedValue([
      { id: 't_a', spaceId: 'sp_1', runAt: '', reason: 'a', payload: {}, source: 'agent', status: 'pending', firedAt: null, cancelledAt: null, createdAt: '', createdByTaskId: null },
      { id: 't_b', spaceId: 'sp_2', runAt: '', reason: 'b', payload: {}, source: 'agent', status: 'pending', firedAt: null, cancelledAt: null, createdAt: '', createdByTaskId: null },
    ]);
    markFiredMock.mockImplementationOnce(async () => {
      throw new Error('row gone');
    });
    const res = await callRoute();
    const body = await res.json();
    expect(body.scheduledFired).toBe(1); // only the second succeeded
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0]).toMatch(/t_a.*row gone/);
  });

  it('continues when listReadyTriggers throws', async () => {
    listReadyMock.mockRejectedValue(new Error('db down'));
    const res = await callRoute();
    const body = await res.json();
    expect(body.scheduledFired).toBe(0);
    expect(body.errors[0]).toMatch(/listReadyTriggers.*db down/);
  });
});

// ── Modal wake dedupe ──────────────────────────────────────────────────

describe('modal wake dedupe', () => {
  it('wakes Modal exactly once per unique space', async () => {
    listReadyMock.mockResolvedValue([
      { id: 't_1', spaceId: 'sp_1', runAt: '', reason: 'a', payload: {}, source: 'agent', status: 'pending', firedAt: null, cancelledAt: null, createdAt: '', createdByTaskId: null },
      { id: 't_2', spaceId: 'sp_1', runAt: '', reason: 'b', payload: {}, source: 'agent', status: 'pending', firedAt: null, cancelledAt: null, createdAt: '', createdByTaskId: null },
      { id: 't_3', spaceId: 'sp_2', runAt: '', reason: 'c', payload: {}, source: 'agent', status: 'pending', firedAt: null, cancelledAt: null, createdAt: '', createdByTaskId: null },
    ]);
    const res = await callRoute();
    const body = await res.json();
    expect(body.scheduledFired).toBe(3);
    expect(body.modalWakes).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const spacesWokenUp = fetchMock.mock.calls.map((c) =>
      JSON.parse((c[1] as RequestInit).body as string).space_id,
    );
    expect(new Set(spacesWokenUp)).toEqual(new Set(['sp_1', 'sp_2']));
  });

  it('reports an error when Modal env vars are missing but triggers fired', async () => {
    delete process.env.MODAL_WEBHOOK_URL;
    listReadyMock.mockResolvedValue([
      { id: 't_1', spaceId: 'sp_1', runAt: '', reason: 'a', payload: {}, source: 'agent', status: 'pending', firedAt: null, cancelledAt: null, createdAt: '', createdByTaskId: null },
    ]);
    const res = await callRoute();
    const body = await res.json();
    expect(body.scheduledFired).toBe(1);
    expect(body.modalWakes).toBe(0);
    expect(body.errors[0]).toMatch(/MODAL_WEBHOOK_URL/);
  });
});
