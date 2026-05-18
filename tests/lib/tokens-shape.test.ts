/**
 * Pins the canonical token values against STYLESHEET.md. Two things this
 * test catches: (a) someone adds a new font size like 18px that doesn't
 * exist; (b) the duration / easing tokens drift away from what
 * lib/motion.ts uses. The values themselves are taste decisions from
 * STYLESHEET — if you want to change them, update the doc first and then
 * this test.
 */
import { describe, it, expect } from 'vitest';
import {
  FONT_SIZE,
  SPACE,
  COLOR,
  NEUTRAL,
  DURATION,
  EASING,
  tokens,
  BANNED_MOTION,
} from '@/lib/tokens';
import { DURATION_BASE, DURATION_FAST, EASE_OUT } from '@/lib/motion';

describe('FONT_SIZE — the only six sizes that exist', () => {
  it('is exactly { 12, 14, 16, 20, 28, 40 }', () => {
    expect(Object.values(FONT_SIZE).sort((a, b) => a - b)).toEqual([
      12, 14, 16, 20, 28, 40,
    ]);
  });
});

describe('SPACE — the 4-pt grid named scale', () => {
  it('every value is a multiple of 4', () => {
    for (const v of Object.values(SPACE)) {
      expect(v % 4).toBe(0);
    }
  });

  it('matches the STYLESHEET named scale (xs sm md lg xl 2xl)', () => {
    expect(SPACE).toEqual({ xs: 4, sm: 8, md: 16, lg: 24, xl: 40, '2xl': 64 });
  });
});

describe('COLOR — semantic roles from STYLESHEET', () => {
  it('accent is the Charles signature deep blue-black', () => {
    expect(COLOR.accent).toBe('#0A0A0F');
  });

  it('all four semantic roles are present and hex-shaped', () => {
    const hexRe = /^#[0-9a-fA-F]{6}$/;
    expect(COLOR.accent).toMatch(hexRe);
    expect(COLOR.positive).toMatch(hexRe);
    expect(COLOR.warning).toMatch(hexRe);
    expect(COLOR.destructive).toMatch(hexRe);
  });
});

describe('NEUTRAL — 9-step scale', () => {
  it('has exactly 9 stops', () => {
    expect(Object.keys(NEUTRAL).length).toBe(9);
  });

  it('lightest is #fafafa, darkest is #0a0a0a', () => {
    expect(NEUTRAL[50]).toBe('#fafafa');
    expect(NEUTRAL[900]).toBe('#0a0a0a');
  });
});

describe('DURATION — three durations, 400ms ceiling', () => {
  it('every value is <= 400', () => {
    for (const v of Object.values(DURATION)) {
      expect(v).toBeLessThanOrEqual(400);
    }
  });

  it('matches lib/motion.ts (durations stay in sync — ms ↔ s)', () => {
    // tokens.ts holds ms (matches STYLESHEET); motion.ts holds seconds
    // (framer-motion convention). Pin the cross-file equality.
    expect(DURATION.micro).toBe(Math.round(DURATION_FAST * 1000));
    expect(DURATION.base).toBe(Math.round(DURATION_BASE * 1000));
  });
});

describe('EASING — one curve, fast out soft in', () => {
  it('is cubic-bezier(0.2, 0.8, 0.2, 1)', () => {
    expect(EASING).toBe('cubic-bezier(0.2, 0.8, 0.2, 1)');
  });

  it('matches lib/motion.ts EASE_OUT (one curve everywhere)', () => {
    expect(EASE_OUT).toEqual([0.2, 0.8, 0.2, 1]);
  });
});

describe('BANNED_MOTION — STYLESHEET prohibitions surfaced', () => {
  it('includes the explicit banned animations', () => {
    expect(BANNED_MOTION).toContain('bounce');
    expect(BANNED_MOTION).toContain('confetti');
    expect(BANNED_MOTION).toContain('parallax');
    expect(BANNED_MOTION).toContain('marquee');
  });
});

describe('tokens namespace', () => {
  it('groups every category under one object', () => {
    expect(tokens.fontSize).toBe(FONT_SIZE);
    expect(tokens.space).toBe(SPACE);
    expect(tokens.color).toBe(COLOR);
    expect(tokens.neutral).toBe(NEUTRAL);
    expect(tokens.duration).toBe(DURATION);
    expect(tokens.easing).toBe(EASING);
  });
});
