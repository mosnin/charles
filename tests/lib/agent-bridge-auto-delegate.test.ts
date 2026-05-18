/**
 * Tests for the fire-and-forget auto-delegate helper.
 *
 * The helper must never throw and must call the bridge with the right
 * shape. We mock the client and assert call args.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/agent-bridge/client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/agent-bridge/client')>(
    '@/lib/agent-bridge/client',
  );
  return { ...actual, callDelegate: vi.fn() };
});

import { callDelegate } from '@/lib/agent-bridge/client';
import { autoDelegate } from '@/lib/agent-bridge/auto-delegate';

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('autoDelegate', () => {
  it('fires callDelegate with the right shape', async () => {
    (callDelegate as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      status: 'completed',
      output: 'ok',
      department: 'engineering',
    });
    autoDelegate({
      spaceId: 'sp_1',
      conversationId: 'c_1',
      department: 'engineering',
      task: 'deploy',
      context: 'urgent',
    });
    // Let the microtask flush
    await Promise.resolve();
    expect(callDelegate).toHaveBeenCalledWith({
      spaceId: 'sp_1',
      runId: 'c_1',
      department: 'engineering',
      task: 'deploy',
      context: 'urgent',
    });
  });

  it('skips invalid departments without calling the bridge', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    autoDelegate({
      spaceId: 'sp_1',
      department: 'finance', // not a real dept
      task: 'do thing',
    });
    expect(callDelegate).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('skips when spaceId or task is missing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    autoDelegate({ spaceId: '', department: 'engineering', task: 't' });
    autoDelegate({ spaceId: 'sp', department: 'engineering', task: '' });
    expect(callDelegate).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it('does not throw when bridge call rejects (logs instead)', async () => {
    (callDelegate as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('nope'),
    );
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() =>
      autoDelegate({
        spaceId: 'sp_1',
        department: 'engineering',
        task: 'deploy',
      }),
    ).not.toThrow();
    // Let microtasks settle
    await Promise.resolve();
    await Promise.resolve();
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});
