/**
 * Vercel adapter tests — auth resolution, reads, and the two write
 * endpoints. We do not test the *gating* of writes here (that lives in the
 * runtime that wires the tools); we just verify the adapter posts what we
 * expect when called.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { maybeSingleMock } = vi.hoisted(() => ({
  maybeSingleMock: vi.fn<() => Promise<{ data: unknown; error: null }>>(),
}));

vi.mock('@/lib/supabase', () => {
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    maybeSingle: maybeSingleMock,
  };
  return { supabase: { from: vi.fn(() => chain) } };
});

import {
  vercelListProjects,
  vercelGetEnvVars,
  vercelSetEnvVar,
  vercelTriggerDeployment,
} from '@/lib/integrations/adapters/vercel';

const fetchMock = vi.fn<typeof fetch>();
global.fetch = fetchMock as unknown as typeof fetch;

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const ORIG = process.env.VERCEL_TOKEN;

beforeEach(() => {
  fetchMock.mockReset();
  maybeSingleMock.mockReset();
  maybeSingleMock.mockResolvedValue({ data: null, error: null });
  delete process.env.VERCEL_TOKEN;
});
afterEach(() => {
  if (ORIG === undefined) delete process.env.VERCEL_TOKEN;
  else process.env.VERCEL_TOKEN = ORIG;
});

describe('Vercel adapter — auth', () => {
  it('uses IntegrationConnection token when present', async () => {
    maybeSingleMock.mockResolvedValue({ data: { accessToken: 'vrc_db' }, error: null });
    fetchMock.mockResolvedValue(jsonRes({ projects: [] }));
    await vercelListProjects('s1');
    const headers = (fetchMock.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer vrc_db');
  });

  it('falls back to VERCEL_TOKEN env when no DB row', async () => {
    process.env.VERCEL_TOKEN = 'vrc_env';
    fetchMock.mockResolvedValue(jsonRes({ projects: [] }));
    await vercelListProjects('s1');
    const headers = (fetchMock.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer vrc_env');
  });

  it('throws when nothing is configured', async () => {
    await expect(vercelListProjects('s1')).rejects.toThrow(/no token/i);
  });
});

describe('Vercel adapter — reads', () => {
  beforeEach(() => {
    process.env.VERCEL_TOKEN = 'vrc';
  });

  it('listProjects returns mapped fields', async () => {
    fetchMock.mockResolvedValue(
      jsonRes({ projects: [{ id: 'p1', name: 'app', framework: 'nextjs' }] }),
    );
    const r = await vercelListProjects('s');
    expect(r).toEqual([{ id: 'p1', name: 'app', framework: 'nextjs' }]);
  });

  it('getEnvVars marks encrypted vars as set, returns no values', async () => {
    fetchMock.mockResolvedValue(
      jsonRes({
        envs: [
          { key: 'API_KEY', type: 'encrypted', target: ['production'] },
          { key: 'PUBLIC_FLAG', value: '1', type: 'plain', target: ['production', 'preview'] },
          { key: 'EMPTY', type: 'plain', target: ['production'] },
        ],
      }),
    );
    const r = await vercelGetEnvVars('s', 'prj_1');
    expect(r).toEqual([
      { key: 'API_KEY', marker: 'set', target: ['production'] },
      { key: 'PUBLIC_FLAG', marker: 'set', target: ['production', 'preview'] },
      { key: 'EMPTY', marker: 'unset', target: ['production'] },
    ]);
    // Verify no value field was returned
    expect(JSON.stringify(r)).not.toContain('value');
  });
});

describe('Vercel adapter — writes', () => {
  beforeEach(() => {
    process.env.VERCEL_TOKEN = 'vrc';
  });

  it('setEnvVar POSTs encrypted body and returns id', async () => {
    fetchMock.mockResolvedValue(jsonRes({ created: { id: 'env_1' } }));
    const r = await vercelSetEnvVar('s', { projectId: 'p1', key: 'K', value: 'V' });
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ key: 'K', value: 'V', target: ['production'], type: 'encrypted' });
    expect(r.id).toBe('env_1');
  });

  it('triggerDeployment posts gitSource ref', async () => {
    fetchMock.mockResolvedValue(jsonRes({ id: 'd1', url: 'd1.vercel.app', readyState: 'QUEUED' }));
    const r = await vercelTriggerDeployment('s', { projectId: 'p1', ref: 'feature' });
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.project).toBe('p1');
    expect(body.gitSource.ref).toBe('feature');
    expect(r).toEqual({ id: 'd1', url: 'd1.vercel.app', state: 'QUEUED' });
  });
});

describe('Vercel adapter — errors', () => {
  beforeEach(() => {
    process.env.VERCEL_TOKEN = 'vrc';
  });

  it('throws with status + message on non-2xx', async () => {
    fetchMock.mockResolvedValue(jsonRes({ error: { message: 'forbidden scope' } }, 403));
    await expect(vercelListProjects('s')).rejects.toThrow(/403.*forbidden scope/);
  });
});
