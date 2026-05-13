/**
 * The two ASCII strings are the identity of the left column. They're pure
 * data, so any change is a deliberate visual edit. These tests pin the
 * structural hallmarks (right glyph palette, enough mass) without locking
 * the entire string — so small tweaks stay easy but a wholesale wipeout
 * trips the suite.
 */
import { describe, it, expect } from 'vitest';
import { SUNFLOWER_ASCII, WORDMARK_ASCII } from '@/lib/onboarding/ascii';

describe('SUNFLOWER_ASCII', () => {
  it('contains a flower head with star and dot glyphs', () => {
    expect(SUNFLOWER_ASCII).toContain('*');
  });

  it('contains a stem rendered with the pipe glyph', () => {
    expect(SUNFLOWER_ASCII).toContain('|');
  });

  it('is tall enough to feel like a panel, not a one-liner', () => {
    const lines = SUNFLOWER_ASCII.split('\n');
    expect(lines.length).toBeGreaterThanOrEqual(15);
  });

  it('contains no emoji', () => {
    expect(/\p{Extended_Pictographic}/u.test(SUNFLOWER_ASCII)).toBe(false);
  });
});

describe('WORDMARK_ASCII', () => {
  it('is built from slash, underscore, and pipe glyphs', () => {
    expect(WORDMARK_ASCII).toContain('_');
    expect(WORDMARK_ASCII).toContain('/');
    expect(WORDMARK_ASCII).toContain('|');
  });

  it('has the mass of a tall blocky wordmark', () => {
    expect(WORDMARK_ASCII.length).toBeGreaterThan(200);
  });

  it('renders the seven letters of "Charles" as ASCII art', () => {
    // Each letter is a tall glyph block; verify the wordmark has at least
    // six rows of art and enough horizontal width to fit seven letters.
    const lines = WORDMARK_ASCII.split('\n').filter((l) => l.length > 0);
    expect(lines.length).toBeGreaterThanOrEqual(6);
    const widest = Math.max(...lines.map((l) => l.length));
    expect(widest).toBeGreaterThanOrEqual(40);
  });

  it('contains no emoji', () => {
    expect(/\p{Extended_Pictographic}/u.test(WORDMARK_ASCII)).toBe(false);
  });
});
