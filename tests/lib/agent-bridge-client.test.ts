/**
 * Tests for the Modal bridge client.
 *
 * Focus: env-config errors, request shape (URL + headers + body), result
 * parsing, and clean errors for non-2xx responses.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const OLD_ENV = { ...process.env };

beforeEach(() => {
  vi.resetModules();
  process.env = { ...OLD_ENV };
  // Wipe any bridge env so each test sets its own
  delete process.env.MODAL_BRIDGE_URL;
  delete process.env.MODAL_BRIDGE_URL_DELEGATE;
  delete process.env.MODAL_BRIDGE_URL_ADVANCE_STAGE;
  delete process.env.MODAL_BRIDGE_URL_GET_MISSION;
  delete process.env.MODAL_BRIDGE_URL_UPDATE_CORE_MEMORY;
  delete process.env.MODAL_BRIDGE_SECRET;
  delete process.env.AGENT_INTERNAL_SECRET;
});

afterEach(() => {
  process.env = { ...OLD_ENV };
  vi.unstubAllGlobals();
});

describe('agent-bridge client', () => {
  it('module loads without env vars (no throw at import)', async () => {
    const mod = await import('@/lib/agent-bridge/client');
    expect(typeof mod.callDelegate).toBe('function');
    expect(typeof mod.callAdvanceStage).toBe('function');
    expect(typeof mod.callGetMission).toBe('function');
    expect(typeof mod.callUpdateCoreMemory).toBe('function');
    expect(mod.isBridgeConfigured()).toBe(false);
  });

  it('isBridgeConfigured returns true when secret + base URL are set', async () => {
    process.env.MODAL_BRIDGE_SECRET = 'sek';
    process.env.MODAL_BRIDGE_URL = 'https://m.example/';
    const mod = await import('@/lib/agent-bridge/client');
    expect(mod.isBridgeConfigured()).toBe(true);
  });

  it('throws BridgeConfigError when secret is missing', async () => {
    process.env.MODAL_BRIDGE_URL = 'https://m.example';
    const mod = await import('@/lib/agent-bridge/client');
    await expect(
      mod.callGetMission('s1'),
    ).rejects.toBeInstanceOf(mod.BridgeConfigError);
  });

  it('throws BridgeConfigError when URL is missing', async () => {
    process.env.MODAL_BRIDGE_SECRET = 'sek';
    const mod = await import('@/lib/agent-bridge/client');
    await expect(
      mod.callGetMission('s1'),
    ).rejects.toBeInstanceOf(mod.BridgeConfigError);
  });

  it('falls back to AGENT_INTERNAL_SECRET when MODAL_BRIDGE_SECRET is unset', async () => {
    process.env.AGENT_INTERNAL_SECRET = 'fallback-sek';
    process.env.MODAL_BRIDGE_URL = 'https://m.example';
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ mission: null, core: {} }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
    const mod = await import('@/lib/agent-bridge/client');
    await mod.callGetMission('s1');
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[1].headers).toMatchObject({
      Authorization: 'Bearer fallback-sek',
    });
  });

  it('rejects unknown department before making any HTTP call', async () => {
    process.env.MODAL_BRIDGE_SECRET = 'sek';
    process.env.MODAL_BRIDGE_URL = 'https://m.example';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
    const mod = await import('@/lib/agent-bridge/client');
    await expect(
      mod.callDelegate({
        spaceId: 's1',
        // @ts-expect-error — testing invalid department
        department: 'finance',
        task: 'do thing',
      }),
    ).rejects.toBeInstanceOf(mod.BridgeConfigError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('callDelegate posts to bridge-delegate with bearer + body + parses result', async () => {
    process.env.MODAL_BRIDGE_SECRET = 'sek';
    process.env.MODAL_BRIDGE_URL = 'https://m.example/';
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          status: 'completed',
          output: 'shipped',
          swarmMemberId: 'sm_1',
          department: 'engineering',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
    const mod = await import('@/lib/agent-bridge/client');

    const out = await mod.callDelegate({
      spaceId: 'sp_1',
      runId: 'run_1',
      department: 'engineering',
      task: 'deploy landing page',
      context: 'urgent',
    });

    expect(out).toEqual({
      status: 'completed',
      output: 'shipped',
      swarmMemberId: 'sm_1',
      department: 'engineering',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[0]).toBe('https://m.example/bridge-delegate');
    expect(call[1].method).toBe('POST');
    expect(call[1].headers).toMatchObject({
      Authorization: 'Bearer sek',
      'Content-Type': 'application/json',
    });
    const sent = JSON.parse(call[1].body as string);
    expect(sent).toEqual({
      spaceId: 'sp_1',
      runId: 'run_1',
      department: 'engineering',
      task: 'deploy landing page',
      context: 'urgent',
    });
  });

  it('callAdvanceStage hits bridge-advance-stage with body', async () => {
    process.env.MODAL_BRIDGE_SECRET = 'sek';
    process.env.MODAL_BRIDGE_URL = 'https://m.example';
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ status: 'completed', output: 'ok', stage: 'building' }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
    const mod = await import('@/lib/agent-bridge/client');

    const out = await mod.callAdvanceStage({
      spaceId: 'sp_1',
      newStage: 'building',
      reason: 'founder override',
    });

    expect(out.stage).toBe('building');
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[0]).toBe('https://m.example/bridge-advance-stage');
    const sent = JSON.parse(call[1].body as string);
    expect(sent).toEqual({
      spaceId: 'sp_1',
      newStage: 'building',
      reason: 'founder override',
    });
  });

  it('callGetMission hits bridge-get-mission with spaceId', async () => {
    process.env.MODAL_BRIDGE_SECRET = 'sek';
    process.env.MODAL_BRIDGE_URL = 'https://m.example';
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ mission: { title: 'Charles' }, core: { tagline: 'Ship' } }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
    const mod = await import('@/lib/agent-bridge/client');

    const out = await mod.callGetMission('sp_2');
    expect(out.mission).toEqual({ title: 'Charles' });
    expect(out.core).toEqual({ tagline: 'Ship' });
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const sent = JSON.parse(call[1].body as string);
    expect(sent).toEqual({ spaceId: 'sp_2' });
  });

  it('callUpdateCoreMemory hits bridge-update-core-memory', async () => {
    process.env.MODAL_BRIDGE_SECRET = 'sek';
    process.env.MODAL_BRIDGE_URL = 'https://m.example';
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, slot: 'tagline', value: 'Ship' }), {
        status: 200,
      }),
    );
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
    const mod = await import('@/lib/agent-bridge/client');

    const out = await mod.callUpdateCoreMemory({
      spaceId: 'sp_1',
      slot: 'tagline',
      value: 'Ship',
    });
    expect(out.ok).toBe(true);
    expect(out.slot).toBe('tagline');
  });

  it('throws BridgeAuthError on 401', async () => {
    process.env.MODAL_BRIDGE_SECRET = 'sek';
    process.env.MODAL_BRIDGE_URL = 'https://m.example';
    const fetchMock = vi.fn(async () =>
      new Response('Unauthorized', { status: 401 }),
    );
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
    const mod = await import('@/lib/agent-bridge/client');
    await expect(mod.callGetMission('s1')).rejects.toBeInstanceOf(mod.BridgeAuthError);
  });

  it('throws BridgeHttpError on 500 and surfaces status', async () => {
    process.env.MODAL_BRIDGE_SECRET = 'sek';
    process.env.MODAL_BRIDGE_URL = 'https://m.example';
    const fetchMock = vi.fn(async () =>
      new Response('boom', { status: 500 }),
    );
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
    const mod = await import('@/lib/agent-bridge/client');
    try {
      await mod.callGetMission('s1');
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(mod.BridgeHttpError);
      expect((err as InstanceType<typeof mod.BridgeHttpError>).status).toBe(500);
    }
  });

  it('throws BridgeHttpError when fetch itself rejects', async () => {
    process.env.MODAL_BRIDGE_SECRET = 'sek';
    process.env.MODAL_BRIDGE_URL = 'https://m.example';
    const fetchMock = vi.fn(async () => {
      throw new Error('network down');
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
    const mod = await import('@/lib/agent-bridge/client');
    await expect(mod.callGetMission('s1')).rejects.toBeInstanceOf(mod.BridgeHttpError);
  });

  it('per-endpoint URL override takes precedence over MODAL_BRIDGE_URL', async () => {
    process.env.MODAL_BRIDGE_SECRET = 'sek';
    process.env.MODAL_BRIDGE_URL = 'https://wrong.example';
    process.env.MODAL_BRIDGE_URL_DELEGATE = 'https://right.example/delegate';
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          status: 'completed',
          output: 'k',
          department: 'sales',
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
    const mod = await import('@/lib/agent-bridge/client');
    await mod.callDelegate({ spaceId: 's1', department: 'sales', task: 't' });
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[0]).toBe('https://right.example/delegate');
  });
});
