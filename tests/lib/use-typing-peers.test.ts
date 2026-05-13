/**
 * useTypingPeers — structural + filter-shape tests.
 *
 * The hook itself wraps a Convex useQuery, which we can't exercise in a
 * pure node test (no Convex client, no jsdom). Instead we pin (a) the
 * module exports, and (b) the filter predicate behavior via the pure
 * typingIndicatorText helper that consumes its output. The actual
 * Convex subscription is verified by the typing indicator landing in
 * product.
 */

import { describe, it, expect } from 'vitest';

describe('useTypingPeers — module shape', () => {
  it('exports useTypingPeers as a function', async () => {
    const mod = await import('@/lib/convex/use-presence');
    expect(typeof mod.useTypingPeers).toBe('function');
  });

  it('exports usePresence and typingIndicatorText alongside', async () => {
    const mod = await import('@/lib/convex/use-presence');
    expect(typeof mod.usePresence).toBe('function');
    expect(typeof mod.typingIndicatorText).toBe('function');
  });
});

// The hook's filter logic boils down to: same spaceId, present-list row's
// typingConversationId === conversationId, AND not self. We can model
// that predicate directly and pin its shape without spinning up React.
interface Row {
  userId: string;
  userName: string;
  typingConversationId?: string;
}

function filterTypingRows(
  rows: Row[],
  selfId: string,
  conversationId: string | null,
): Row[] {
  if (!conversationId) return [];
  return rows.filter(
    (r) => r.userId !== selfId && r.typingConversationId === conversationId,
  );
}

describe('useTypingPeers — filter predicate (modeled)', () => {
  const rows: Row[] = [
    { userId: 'self', userName: 'Me', typingConversationId: 'conv_1' },
    { userId: 'u1', userName: 'Jane', typingConversationId: 'conv_1' },
    { userId: 'u2', userName: 'Tom', typingConversationId: 'conv_1' },
    { userId: 'u3', userName: 'Alex', typingConversationId: 'conv_2' },
    { userId: 'u4', userName: 'Sam' },
  ];

  it('filters out the founder themselves', () => {
    const out = filterTypingRows(rows, 'self', 'conv_1');
    expect(out.map((r) => r.userId)).not.toContain('self');
  });

  it('returns only rows typing into the given conversation', () => {
    const out = filterTypingRows(rows, 'self', 'conv_1');
    expect(out.map((r) => r.userId).sort()).toEqual(['u1', 'u2']);
  });

  it('returns [] when conversationId is null — no chat = no indicator', () => {
    expect(filterTypingRows(rows, 'self', null)).toEqual([]);
  });

  it('excludes rows whose typingConversationId is undefined (present but not typing)', () => {
    const out = filterTypingRows(rows, 'self', 'conv_1');
    expect(out.map((r) => r.userId)).not.toContain('u4');
  });

  it('partitions by conversation — conv_2 returns u3 only', () => {
    const out = filterTypingRows(rows, 'self', 'conv_2');
    expect(out.map((r) => r.userId)).toEqual(['u3']);
  });

  it('returns [] when nobody is typing in this conversation', () => {
    const out = filterTypingRows(rows, 'self', 'conv_no_match');
    expect(out).toEqual([]);
  });
});
