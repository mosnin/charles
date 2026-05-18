/**
 * Typing-indicator copy — phrasing matrix.
 *
 * The indicator is a single line of italic text under the message list.
 * These tests pin the wording for 0, 1, 2, and 3+ typers so any future
 * "let's tweak it" PR has to walk through each branch on purpose. No
 * render tests — the project doesn't ship jsdom (see
 * approval-celebration.test.ts for the policy).
 */

import { describe, it, expect } from 'vitest';
import { typingIndicatorText } from '@/lib/convex/use-presence';

describe('typingIndicatorText', () => {
  it('returns null for zero typers — no indicator at all', () => {
    expect(typingIndicatorText([])).toBeNull();
  });

  it('renders "Jane is typing…" for one typer', () => {
    expect(typingIndicatorText(['Jane'])).toBe('Jane is typing…');
  });

  it('renders "Jane and Tom are typing…" for two typers', () => {
    expect(typingIndicatorText(['Jane', 'Tom'])).toBe('Jane and Tom are typing…');
  });

  it('renders "3 people are typing…" for three typers — avoids comma soup', () => {
    expect(typingIndicatorText(['Jane', 'Tom', 'Alex'])).toBe('3 people are typing…');
  });

  it('renders "4 people are typing…" for four', () => {
    expect(typingIndicatorText(['A', 'B', 'C', 'D'])).toBe('4 people are typing…');
  });

  it('ignores whitespace-only names so a bad presence row does not produce "  is typing…"', () => {
    expect(typingIndicatorText(['  '])).toBeNull();
    expect(typingIndicatorText(['Jane', '   '])).toBe('Jane is typing…');
  });

  it('trims surrounding whitespace on names', () => {
    expect(typingIndicatorText(['  Jane  '])).toBe('Jane is typing…');
  });

  it('always ends with the horizontal ellipsis glyph, not three dots', () => {
    const one = typingIndicatorText(['X']);
    const two = typingIndicatorText(['X', 'Y']);
    const three = typingIndicatorText(['X', 'Y', 'Z']);
    expect(one?.endsWith('…')).toBe(true);
    expect(two?.endsWith('…')).toBe(true);
    expect(three?.endsWith('…')).toBe(true);
  });

  it('uses "is" for singular, "are" for plural', () => {
    expect(typingIndicatorText(['Jane'])).toMatch(/ is typing/);
    expect(typingIndicatorText(['Jane', 'Tom'])).toMatch(/ are typing/);
    expect(typingIndicatorText(['A', 'B', 'C'])).toMatch(/ are typing/);
  });
});
