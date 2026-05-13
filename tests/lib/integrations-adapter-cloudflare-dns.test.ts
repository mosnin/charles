/**
 * Cloudflare DNS adapter tests — auth, reads, mutations, and the
 * Phase 4 scope cut: `cloudflareRegisterDomain` must NOT hit the API.
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
  cloudflareListZones,
  cloudflareListRecords,
  cloudflareCreateRecord,
  cloudflareUpdateRecord,
  cloudflareDeleteRecord,
  cloudflareCheckDomainAvailability,
  cloudflareRegisterDomain,
} from '@/lib/integrations/adapters/cloudflare-dns';

const fetchMock = vi.fn<typeof fetch>();
global.fetch = fetchMock as unknown as typeof fetch;

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const ORIG = process.env.CLOUDFLARE_API_TOKEN;

beforeEach(() => {
  fetchMock.mockReset();
  maybeSingleMock.mockReset();
  maybeSingleMock.mockResolvedValue({ data: null, error: null });
  delete process.env.CLOUDFLARE_API_TOKEN;
});
afterEach(() => {
  if (ORIG === undefined) delete process.env.CLOUDFLARE_API_TOKEN;
  else process.env.CLOUDFLARE_API_TOKEN = ORIG;
});

describe('Cloudflare DNS adapter — auth', () => {
  it('uses IntegrationConnection token when present', async () => {
    maybeSingleMock.mockResolvedValue({ data: { accessToken: 'cf_db' }, error: null });
    fetchMock.mockResolvedValue(jsonRes({ result: [] }));
    await cloudflareListZones('s1');
    const headers = (fetchMock.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer cf_db');
  });

  it('falls back to CLOUDFLARE_API_TOKEN env when no DB row', async () => {
    process.env.CLOUDFLARE_API_TOKEN = 'cf_env';
    fetchMock.mockResolvedValue(jsonRes({ result: [] }));
    await cloudflareListZones('s1');
    const headers = (fetchMock.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer cf_env');
  });

  it('throws when nothing is configured', async () => {
    await expect(cloudflareListZones('s1')).rejects.toThrow(/no API token/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('Cloudflare DNS adapter — zones + records', () => {
  beforeEach(() => {
    process.env.CLOUDFLARE_API_TOKEN = 'cf_test';
  });

  it('listZones maps id + name', async () => {
    fetchMock.mockResolvedValue(
      jsonRes({ result: [{ id: 'z1', name: 'example.com', status: 'active' }] }),
    );
    const r = await cloudflareListZones('s');
    expect(r).toEqual([{ id: 'z1', name: 'example.com' }]);
  });

  it('listRecords without filter omits the type query', async () => {
    fetchMock.mockResolvedValue(jsonRes({ result: [] }));
    await cloudflareListRecords('s', { zoneId: 'z1' });
    const url = String(fetchMock.mock.calls[0]![0]);
    expect(url).toContain('/zones/z1/dns_records');
    expect(url).not.toContain('type=');
  });

  it('listRecords with type filter sets the query param uppercased', async () => {
    fetchMock.mockResolvedValue(jsonRes({ result: [] }));
    await cloudflareListRecords('s', { zoneId: 'z1', type: 'cname' });
    const url = String(fetchMock.mock.calls[0]![0]);
    expect(url).toContain('type=CNAME');
  });

  it('listRecords maps record fields', async () => {
    fetchMock.mockResolvedValue(
      jsonRes({
        result: [
          {
            id: 'r1',
            type: 'A',
            name: 'example.com',
            content: '1.2.3.4',
            ttl: 300,
            proxied: false,
          },
        ],
      }),
    );
    const r = await cloudflareListRecords('s', { zoneId: 'z1' });
    expect(r[0]).toEqual({
      id: 'r1',
      type: 'A',
      name: 'example.com',
      content: '1.2.3.4',
      ttl: 300,
      proxied: false,
    });
  });

  it('createRecord POSTs the payload and returns mapped record', async () => {
    fetchMock.mockResolvedValue(
      jsonRes({
        result: {
          id: 'r2',
          type: 'CNAME',
          name: 'www.example.com',
          content: 'example.com',
          ttl: 1,
          proxied: true,
        },
      }),
    );
    const r = await cloudflareCreateRecord('s', {
      zoneId: 'z1',
      type: 'cname',
      name: 'www.example.com',
      content: 'example.com',
      proxied: true,
    });
    expect(r.id).toBe('r2');
    expect(r.proxied).toBe(true);
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      type: 'CNAME',
      name: 'www.example.com',
      content: 'example.com',
      ttl: 1,
      proxied: true,
    });
  });

  it('updateRecord PATCHes content/ttl/proxied', async () => {
    fetchMock.mockResolvedValue(
      jsonRes({ result: { id: 'r1', type: 'A', name: 'x', content: '9.9.9.9', ttl: 60, proxied: false } }),
    );
    const r = await cloudflareUpdateRecord('s', {
      zoneId: 'z1',
      recordId: 'r1',
      content: '9.9.9.9',
      ttl: 60,
    });
    expect(r.content).toBe('9.9.9.9');
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe('PATCH');
    expect(String(fetchMock.mock.calls[0]![0])).toContain('/zones/z1/dns_records/r1');
  });

  it('deleteRecord DELETEs the record', async () => {
    fetchMock.mockResolvedValue(jsonRes({ result: { id: 'r1' } }));
    const r = await cloudflareDeleteRecord('s', { zoneId: 'z1', recordId: 'r1' });
    expect(r.id).toBe('r1');
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe('DELETE');
  });

  it('surfaces Cloudflare error message on non-2xx', async () => {
    fetchMock.mockResolvedValue(
      jsonRes({ errors: [{ message: 'Invalid zone' }] }, 400),
    );
    await expect(cloudflareListRecords('s', { zoneId: 'bad' })).rejects.toThrow(
      /400.*Invalid zone/,
    );
  });
});

describe('Cloudflare DNS adapter — domain availability + register stub', () => {
  beforeEach(() => {
    process.env.CLOUDFLARE_API_TOKEN = 'cf_test';
  });

  it('checkDomainAvailability returns available + price', async () => {
    fetchMock.mockResolvedValue(
      jsonRes({ result: { available: true, price: 9.15, currency: 'USD' } }),
    );
    const r = await cloudflareCheckDomainAvailability('s', 'example.com');
    expect(r).toEqual({ status: 'available', price: 9.15, currency: 'USD' });
  });

  it('checkDomainAvailability returns unavailable', async () => {
    fetchMock.mockResolvedValue(jsonRes({ result: { available: false } }));
    const r = await cloudflareCheckDomainAvailability('s', 'taken.com');
    expect(r.status).toBe('unavailable');
  });

  it('checkDomainAvailability returns unknown when Cloudflare omits available', async () => {
    fetchMock.mockResolvedValue(jsonRes({ result: {} }));
    const r = await cloudflareCheckDomainAvailability('s', 'weird.com');
    expect(r.status).toBe('unknown');
  });

  it('registerDomain returns approval stub WITHOUT hitting the API', async () => {
    const r = await cloudflareRegisterDomain('s', { domain: 'example.com', years: 2 });
    expect(r.requiresApproval).toBe(true);
    expect(r.message).toContain('ACTION REQUIRES APPROVAL');
    expect(r.message).toContain('example.com');
    expect(r.message).toContain('2 year(s)');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('registerDomain defaults years to 1', async () => {
    const r = await cloudflareRegisterDomain('s', { domain: 'example.com' });
    expect(r.message).toContain('1 year(s)');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
