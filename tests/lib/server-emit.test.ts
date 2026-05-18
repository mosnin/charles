/**
 * Tests for `emitCanvasActivity`.
 *
 * The function is best-effort and must never throw or reject. It must
 * no-op when NEXT_PUBLIC_CONVEX_URL is unset, attach a service JWT when
 * one is provided, and swallow underlying HTTP failures.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mutationMock = vi.fn();
const setAuthMock = vi.fn();
let constructorCalls = 0;

vi.mock('convex/browser', () => ({
  ConvexHttpClient: class {
    constructor(public address: string) {
      constructorCalls += 1;
    }
    setAuth(token: string) {
      setAuthMock(token);
    }
    mutation(...args: unknown[]) {
      return mutationMock(...args);
    }
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { emitCanvasActivity } from '@/lib/convex/server-emit';

const ENV_KEYS = ['NEXT_PUBLIC_CONVEX_URL', 'CONVEX_SERVICE_JWT'] as const;
const saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

function snap() {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
}
function restore() {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
}

describe('emitCanvasActivity', () => {
  beforeEach(() => {
    snap();
    mutationMock.mockReset();
    setAuthMock.mockReset();
    constructorCalls = 0;
    delete process.env.NEXT_PUBLIC_CONVEX_URL;
    delete process.env.CONVEX_SERVICE_JWT;
  });
  afterEach(() => {
    restore();
  });

  it('returns false and does nothing when NEXT_PUBLIC_CONVEX_URL is unset', async () => {
    const ok = await emitCanvasActivity({
      spaceId: 'space-1',
      department: 'engineering',
      kind: 'running',
      summary: 'building',
    });
    expect(ok).toBe(false);
    expect(constructorCalls).toBe(0);
    expect(mutationMock).not.toHaveBeenCalled();
  });

  it('calls the Convex mutation with passed args and returns true on success', async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = 'https://x.convex.cloud';
    mutationMock.mockResolvedValueOnce('ok');

    const ok = await emitCanvasActivity({
      spaceId: 'space-1',
      department: 'sales',
      kind: 'queued',
      summary: 'prospecting',
    });

    expect(ok).toBe(true);
    expect(constructorCalls).toBe(1);
    expect(mutationMock).toHaveBeenCalledTimes(1);
    const callArgs = mutationMock.mock.calls[0]?.[1];
    expect(callArgs).toEqual({
      spaceId: 'space-1',
      department: 'sales',
      kind: 'queued',
      summary: 'prospecting',
    });
  });

  it('attaches the service JWT when CONVEX_SERVICE_JWT is set', async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = 'https://x.convex.cloud';
    process.env.CONVEX_SERVICE_JWT = 'jwt-token-abc';
    mutationMock.mockResolvedValueOnce('ok');

    await emitCanvasActivity({
      spaceId: 's',
      department: 'design',
      kind: 'done',
      summary: 'shipped',
    });

    expect(setAuthMock).toHaveBeenCalledWith('jwt-token-abc');
  });

  it('skips setAuth when CONVEX_SERVICE_JWT is empty / unset', async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = 'https://x.convex.cloud';
    mutationMock.mockResolvedValueOnce('ok');

    await emitCanvasActivity({
      spaceId: 's',
      department: 'design',
      kind: 'done',
      summary: 'shipped',
    });
    expect(setAuthMock).not.toHaveBeenCalled();
  });

  it('returns false and never throws when the mutation rejects', async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = 'https://x.convex.cloud';
    mutationMock.mockRejectedValueOnce(new Error('boom'));

    const ok = await emitCanvasActivity({
      spaceId: 's',
      department: 'support',
      kind: 'failed',
      summary: 'oops',
    });
    expect(ok).toBe(false);
  });

  it('accepts every valid department slug', async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = 'https://x.convex.cloud';
    mutationMock.mockResolvedValue('ok');
    const depts = [
      'engineering',
      'sales',
      'marketing',
      'design',
      'support',
      'ops_finance',
    ] as const;
    for (const d of depts) {
      const ok = await emitCanvasActivity({
        spaceId: 's',
        department: d,
        kind: 'running',
        summary: d,
      });
      expect(ok).toBe(true);
    }
    expect(mutationMock).toHaveBeenCalledTimes(depts.length);
  });

  it('accepts every valid kind', async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = 'https://x.convex.cloud';
    mutationMock.mockResolvedValue('ok');
    const kinds = ['running', 'queued', 'done', 'failed'] as const;
    for (const k of kinds) {
      const ok = await emitCanvasActivity({
        spaceId: 's',
        department: 'engineering',
        kind: k,
        summary: 'x',
      });
      expect(ok).toBe(true);
    }
  });
});
