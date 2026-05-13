/**
 * Tests for the useTaskChat hook. We mock convex/react and stub React's
 * dispatcher-aware hooks (useState/useEffect/useMemo/useCallback) so
 * the hook can be invoked directly outside a React tree. That's enough
 * to assert its return shape and verify send() dual-fires the Convex
 * mutation and the Supabase-backed POST in parallel.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mockMutation = vi.fn(async (_args?: unknown) => 'live_msg_1' as unknown);
const useQueryMock = vi.fn((_name?: unknown, _args?: unknown) => undefined as unknown);
const useMutationMock = vi.fn((_name?: unknown) => mockMutation);

vi.mock('convex/react', () => ({
  useQuery: (a: unknown, b: unknown) => useQueryMock(a, b),
  useMutation: (a: unknown) => useMutationMock(a),
}));

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    useState: <T,>(initial: T) => {
      const ref = { current: initial as T };
      const setter = (v: T | ((p: T) => T)) => {
        ref.current =
          typeof v === 'function' ? (v as (p: T) => T)(ref.current) : v;
      };
      return [ref.current, setter] as [T, (v: T | ((p: T) => T)) => void];
    },
    useEffect: (_fn: () => void) => undefined,
    useMemo: <T,>(fn: () => T) => fn(),
    useCallback: <T,>(fn: T) => fn,
  };
});

import { useTaskChat } from '@/lib/convex/use-task-chat';

const globalAny = globalThis as unknown as { fetch: typeof fetch };
const originalFetch = globalAny.fetch;

function defaultFetch(): typeof fetch {
  return vi.fn(async () =>
    new Response(
      JSON.stringify({
        user: {
          id: 's_u',
          role: 'user',
          content: 'hello',
          metadata: null,
          createdAt: '2026-05-13T00:00:00.000Z',
        },
        assistant: {
          id: 's_a',
          role: 'assistant',
          content: 'hi',
          metadata: { delegatedTo: 'engineering' },
          createdAt: '2026-05-13T00:00:01.000Z',
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ),
  ) as unknown as typeof fetch;
}

beforeEach(() => {
  vi.clearAllMocks();
  useQueryMock.mockReturnValue(undefined);
  useMutationMock.mockReturnValue(mockMutation);
  mockMutation.mockReset();
  mockMutation.mockResolvedValue('live_msg_1');
  globalAny.fetch = defaultFetch();
});

afterEach(() => {
  globalAny.fetch = originalFetch;
});

describe('useTaskChat', () => {
  it('returns the canonical message shape and an isSending flag', () => {
    const result = useTaskChat({
      spaceId: 'space_1',
      conversationId: 'conv_1',
      initialMessages: [],
    });
    expect(result).toMatchObject({
      messages: expect.any(Array),
      send: expect.any(Function),
      isSending: false,
      isLive: false,
    });
  });

  it('isLive is true once useQuery returns rows', () => {
    useQueryMock.mockReturnValue([
      {
        _id: 'live_1',
        role: 'user',
        content: 'hey',
        metadata: null,
        createdAt: 1_700_000_000_000,
      },
    ] as unknown as undefined);
    const result = useTaskChat({
      spaceId: 'space_1',
      conversationId: 'conv_1',
    });
    expect(result.isLive).toBe(true);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toMatchObject({
      id: 'live_1',
      role: 'user',
      content: 'hey',
      createdAt: 1_700_000_000_000,
    });
  });

  it('falls back to initialMessages when Convex is unavailable', () => {
    useQueryMock.mockReturnValue(undefined);
    const result = useTaskChat({
      spaceId: 'space_1',
      conversationId: 'conv_1',
      initialMessages: [
        {
          id: 'seed_1',
          role: 'assistant',
          content: 'hello there',
          metadata: null,
          createdAt: 1,
        },
      ],
    });
    expect(result.isLive).toBe(false);
    expect(result.messages).toEqual([
      {
        id: 'seed_1',
        role: 'assistant',
        content: 'hello there',
        metadata: null,
        createdAt: 1,
      },
    ]);
  });

  it('passes "skip" to useQuery when conversationId is null', () => {
    useTaskChat({ spaceId: 'space_1', conversationId: null });
    const lastCall = useQueryMock.mock.calls.at(-1);
    expect(lastCall?.[1]).toBe('skip');
  });

  it('send() fires both the Convex mutation and the fetch POST', async () => {
    const result = useTaskChat({
      spaceId: 'space_1',
      conversationId: 'conv_1',
    });
    await result.send('what is up');
    expect(mockMutation).toHaveBeenCalledTimes(1);
    expect(mockMutation).toHaveBeenCalledWith({
      conversationId: 'conv_1',
      spaceId: 'space_1',
      role: 'user',
      content: 'what is up',
    });
    const fetchMock = globalAny.fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const firstCall = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(firstCall[0]).toBe('/api/task-conversations/conv_1/messages');
    expect(firstCall[1].method).toBe('POST');
    expect(firstCall[1].body).toBe(JSON.stringify({ content: 'what is up' }));
  });

  it('send() is a no-op when conversationId is null', async () => {
    const result = useTaskChat({ spaceId: 'space_1', conversationId: null });
    await result.send('hi');
    expect(mockMutation).not.toHaveBeenCalled();
    expect(
      (globalAny.fetch as unknown as ReturnType<typeof vi.fn>),
    ).not.toHaveBeenCalled();
  });

  it('send() trims and ignores empty content', async () => {
    const result = useTaskChat({
      spaceId: 'space_1',
      conversationId: 'conv_1',
    });
    await result.send('   ');
    expect(mockMutation).not.toHaveBeenCalled();
    expect(
      (globalAny.fetch as unknown as ReturnType<typeof vi.fn>),
    ).not.toHaveBeenCalled();
  });

  it('send() swallows a Convex failure when POST succeeds', async () => {
    mockMutation.mockRejectedValueOnce(new Error('convex down'));
    const result = useTaskChat({
      spaceId: 'space_1',
      conversationId: 'conv_1',
    });
    await expect(result.send('hi')).resolves.toBeUndefined();
    const fetchMock = globalAny.fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('send() rejects when the fetch POST fails', async () => {
    (globalAny.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response('boom', { status: 500 }),
    );
    const result = useTaskChat({
      spaceId: 'space_1',
      conversationId: 'conv_1',
    });
    await expect(result.send('hi')).rejects.toThrow();
  });

  it('maps Convex rows to ChatMessage with id, role, content, createdAt', () => {
    useQueryMock.mockReturnValue([
      {
        _id: 'a',
        role: 'assistant',
        content: 'reply',
        metadata: { delegatedTo: 'sales' },
        createdAt: 42,
      },
      {
        _id: 'b',
        role: 'user',
        content: 'q',
        metadata: null,
        createdAt: 43,
      },
    ] as unknown as undefined);
    const result = useTaskChat({
      spaceId: 'space_1',
      conversationId: 'conv_1',
    });
    expect(result.messages).toEqual([
      {
        id: 'a',
        role: 'assistant',
        content: 'reply',
        metadata: { delegatedTo: 'sales' },
        createdAt: 42,
      },
      {
        id: 'b',
        role: 'user',
        content: 'q',
        metadata: null,
        createdAt: 43,
      },
    ]);
  });
});
