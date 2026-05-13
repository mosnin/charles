/**
 * Loops adapter tests — auth resolution, mutations, lookups, errors.
 *
 * The approval gate that wraps mutating calls lives in the runtime, not
 * this adapter, so we only verify the adapter posts/parses correctly.
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
  loopsSendTransactional,
  loopsSendEvent,
  loopsUpsertContact,
  loopsFindContact,
} from '@/lib/integrations/adapters/loops';

const fetchMock = vi.fn<typeof fetch>();
global.fetch = fetchMock as unknown as typeof fetch;

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const ORIG = process.env.LOOPS_API_KEY;

beforeEach(() => {
  fetchMock.mockReset();
  maybeSingleMock.mockReset();
  maybeSingleMock.mockResolvedValue({ data: null, error: null });
  delete process.env.LOOPS_API_KEY;
});
afterEach(() => {
  if (ORIG === undefined) delete process.env.LOOPS_API_KEY;
  else process.env.LOOPS_API_KEY = ORIG;
});

describe('Loops adapter — auth', () => {
  it('uses IntegrationConnection token when present', async () => {
    maybeSingleMock.mockResolvedValue({ data: { accessToken: 'lp_db' }, error: null });
    fetchMock.mockResolvedValue(jsonRes({ success: true }));
    await loopsSendTransactional('s1', { email: 'a@b.co', transactionalId: 'tx_1' });
    const headers = (fetchMock.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer lp_db');
  });

  it('falls back to LOOPS_API_KEY env when no DB row', async () => {
    process.env.LOOPS_API_KEY = 'lp_env';
    fetchMock.mockResolvedValue(jsonRes({ success: true }));
    await loopsSendTransactional('s1', { email: 'a@b.co', transactionalId: 'tx_1' });
    const headers = (fetchMock.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer lp_env');
  });

  it('throws when nothing is configured', async () => {
    await expect(
      loopsSendTransactional('s1', { email: 'a@b.co', transactionalId: 'tx_1' }),
    ).rejects.toThrow(/no API key/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('Loops adapter — mutations', () => {
  beforeEach(() => {
    process.env.LOOPS_API_KEY = 'lp_test';
  });

  it('sendTransactional posts payload with dataVariables', async () => {
    fetchMock.mockResolvedValue(jsonRes({ success: true }));
    const r = await loopsSendTransactional('s', {
      email: 'a@b.co',
      transactionalId: 'tx_1',
      dataVariables: { firstName: 'Ada' },
    });
    expect(r).toEqual({ success: true });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain('/transactional');
    expect((init as RequestInit).method).toBe('POST');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({
      email: 'a@b.co',
      transactionalId: 'tx_1',
      dataVariables: { firstName: 'Ada' },
    });
  });

  it('sendTransactional omits dataVariables when not provided', async () => {
    fetchMock.mockResolvedValue(jsonRes({ success: true }));
    await loopsSendTransactional('s', { email: 'a@b.co', transactionalId: 'tx_1' });
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.dataVariables).toBeUndefined();
  });

  it('sendEvent posts eventName + eventProperties', async () => {
    fetchMock.mockResolvedValue(jsonRes({ success: true }));
    const r = await loopsSendEvent('s', {
      email: 'a@b.co',
      eventName: 'signup',
      properties: { plan: 'pro' },
    });
    expect(r).toEqual({ success: true });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain('/events/send');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({
      email: 'a@b.co',
      eventName: 'signup',
      eventProperties: { plan: 'pro' },
    });
  });

  it('upsertContact returns id from response', async () => {
    fetchMock.mockResolvedValue(jsonRes({ id: 'cnt_1', success: true }));
    const r = await loopsUpsertContact('s', {
      email: 'a@b.co',
      firstName: 'Ada',
      subscribed: true,
    });
    expect(r).toEqual({ id: 'cnt_1' });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain('/contacts/update');
    expect((init as RequestInit).method).toBe('PUT');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.email).toBe('a@b.co');
    expect(body.firstName).toBe('Ada');
    expect(body.subscribed).toBe(true);
  });

  it('upsertContact defaults subscribed to true', async () => {
    fetchMock.mockResolvedValue(jsonRes({ id: 'cnt_1' }));
    await loopsUpsertContact('s', { email: 'a@b.co' });
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.subscribed).toBe(true);
  });
});

describe('Loops adapter — find', () => {
  beforeEach(() => {
    process.env.LOOPS_API_KEY = 'lp_test';
  });

  it('findContact returns mapped contact from array response', async () => {
    fetchMock.mockResolvedValue(
      jsonRes([{ id: 'c1', email: 'a@b.co', firstName: 'Ada', subscribed: true }]),
    );
    const r = await loopsFindContact('s', 'a@b.co');
    expect(r).toEqual({
      id: 'c1',
      email: 'a@b.co',
      firstName: 'Ada',
      lastName: undefined,
      subscribed: true,
    });
  });

  it('findContact returns null on 404', async () => {
    fetchMock.mockResolvedValue(jsonRes({ message: 'not found' }, 404));
    const r = await loopsFindContact('s', 'missing@b.co');
    expect(r).toBeNull();
  });

  it('findContact returns null on empty array', async () => {
    fetchMock.mockResolvedValue(jsonRes([]));
    const r = await loopsFindContact('s', 'missing@b.co');
    expect(r).toBeNull();
  });
});

describe('Loops adapter — errors', () => {
  beforeEach(() => {
    process.env.LOOPS_API_KEY = 'lp_test';
  });

  it('surfaces status + message on non-2xx', async () => {
    fetchMock.mockResolvedValue(jsonRes({ message: 'Invalid transactional id' }, 422));
    await expect(
      loopsSendTransactional('s', { email: 'a@b.co', transactionalId: 'bad' }),
    ).rejects.toThrow(/422.*Invalid transactional id/);
  });

  it('surfaces 401 auth errors', async () => {
    fetchMock.mockResolvedValue(jsonRes({ message: 'Unauthorized' }, 401));
    await expect(
      loopsSendEvent('s', { email: 'a@b.co', eventName: 'x' }),
    ).rejects.toThrow(/401/);
  });
});
