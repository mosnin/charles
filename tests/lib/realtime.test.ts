/**
 * Realtime subscriptions — verify the canvas helpers subscribe to the
 * right tables, call onChange for incoming events, and clean up via
 * removeChannel on unsubscribe. Falls back to a no-op when the browser
 * client is unavailable.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { getBrowser } = vi.hoisted(() => ({
  getBrowser: vi.fn(),
}));

vi.mock('@/lib/supabase-browser', () => ({
  getSupabaseBrowser: getBrowser,
}));

import {
  subscribeToDeptActivity,
  subscribeToAuditFeed,
} from '@/lib/canvas/realtime';

interface FakeChannel {
  handlers: Array<{ event: string; cfg: Record<string, unknown>; cb: () => void }>;
  on: (event: string, cfg: Record<string, unknown>, cb: () => void) => FakeChannel;
  subscribe: () => FakeChannel;
}

function makeFakeClient() {
  const channels: FakeChannel[] = [];
  const removeSpy = vi.fn();
  const subscribeSpy = vi.fn();
  const channelSpy = vi.fn((name: string) => {
    const ch: FakeChannel = {
      handlers: [],
      on(event, cfg, cb) {
        this.handlers.push({ event, cfg, cb });
        return this;
      },
      subscribe() {
        subscribeSpy(name);
        return this;
      },
    };
    channels.push(ch);
    return ch;
  });
  const client = {
    channel: channelSpy,
    removeChannel: removeSpy,
  };
  return { client, channels, removeSpy, subscribeSpy, channelSpy };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('subscribeToDeptActivity', () => {
  it('returns a no-op when the browser client is unavailable', () => {
    getBrowser.mockReturnValue(null);
    const onChange = vi.fn();
    const unsub = subscribeToDeptActivity('space_1', onChange);
    expect(typeof unsub).toBe('function');
    // Calling unsubscribe should not throw.
    unsub();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('subscribes to SwarmMember, AgentDraft, AgentPausedRun', () => {
    const fake = makeFakeClient();
    getBrowser.mockReturnValue(fake.client);
    subscribeToDeptActivity('space_1', () => {});
    expect(fake.channelSpy).toHaveBeenCalledWith('canvas:dept:space_1');
    expect(fake.subscribeSpy).toHaveBeenCalledTimes(1);
    const tables = fake.channels[0].handlers.map((h) => h.cfg.table);
    expect(tables).toEqual(['SwarmMember', 'AgentDraft', 'AgentPausedRun']);
  });

  it('filters AgentDraft and AgentPausedRun by spaceId', () => {
    const fake = makeFakeClient();
    getBrowser.mockReturnValue(fake.client);
    subscribeToDeptActivity('space_1', () => {});
    const byTable = Object.fromEntries(
      fake.channels[0].handlers.map((h) => [h.cfg.table, h.cfg.filter]),
    );
    expect(byTable['AgentDraft']).toBe('spaceId=eq.space_1');
    expect(byTable['AgentPausedRun']).toBe('spaceId=eq.space_1');
    // SwarmMember has no spaceId column — we accept the cross-workspace noise.
    expect(byTable['SwarmMember']).toBeUndefined();
  });

  it('invokes onChange when any postgres_changes event fires', () => {
    const fake = makeFakeClient();
    getBrowser.mockReturnValue(fake.client);
    const onChange = vi.fn();
    subscribeToDeptActivity('space_1', onChange);
    for (const h of fake.channels[0].handlers) h.cb();
    expect(onChange).toHaveBeenCalledTimes(3);
  });

  it('calls removeChannel exactly once on unsubscribe', () => {
    const fake = makeFakeClient();
    getBrowser.mockReturnValue(fake.client);
    const unsub = subscribeToDeptActivity('space_1', () => {});
    unsub();
    unsub();
    expect(fake.removeSpy).toHaveBeenCalledTimes(1);
  });
});

describe('subscribeToAuditFeed', () => {
  it('returns a no-op when the browser client is unavailable', () => {
    getBrowser.mockReturnValue(null);
    const onChange = vi.fn();
    const unsub = subscribeToAuditFeed('space_1', onChange);
    expect(typeof unsub).toBe('function');
    unsub();
  });

  it('subscribes to all four audit-feed tables', () => {
    const fake = makeFakeClient();
    getBrowser.mockReturnValue(fake.client);
    subscribeToAuditFeed('space_1', () => {});
    expect(fake.channelSpy).toHaveBeenCalledWith('canvas:audit:space_1');
    const tables = fake.channels[0].handlers.map((h) => h.cfg.table);
    expect(tables).toEqual([
      'SwarmMember',
      'AgentDraft',
      'AgentPausedRun',
      'TaskMessage',
    ]);
  });

  it('cleans up channel on unsubscribe', () => {
    const fake = makeFakeClient();
    getBrowser.mockReturnValue(fake.client);
    const unsub = subscribeToAuditFeed('space_1', () => {});
    unsub();
    expect(fake.removeSpy).toHaveBeenCalledTimes(1);
  });

  it('tolerates removeChannel throwing', () => {
    const fake = makeFakeClient();
    fake.removeSpy.mockImplementation(() => {
      throw new Error('boom');
    });
    getBrowser.mockReturnValue(fake.client);
    const unsub = subscribeToAuditFeed('space_1', () => {});
    expect(() => unsub()).not.toThrow();
  });
});
