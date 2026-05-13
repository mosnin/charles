/**
 * Tests for the canvas typography additions in `lib/typography.ts`.
 *
 * These guard the cofounder.co-style serif/mono helpers so a future refactor
 * can't accidentally drop one of them — the canvas components import them
 * directly and a missing export would break the build silently in places
 * we don't render in tests.
 */

import { describe, it, expect } from 'vitest';

import {
  SERIF_DISPLAY,
  SERIF_CARD,
  MONO_CHIP,
  MONO_META,
  SERIF_FONT_STYLE,
} from '@/lib/typography';

describe('canvas typography helpers', () => {
  it('SERIF_DISPLAY is a string with font-serif + display-scale classes', () => {
    expect(typeof SERIF_DISPLAY).toBe('string');
    expect(SERIF_DISPLAY).toContain('font-serif');
    expect(SERIF_DISPLAY).toContain('font-medium');
    expect(SERIF_DISPLAY).toContain('text-[28px]');
    expect(SERIF_DISPLAY).toContain('leading-tight');
    expect(SERIF_DISPLAY).toContain('tracking-tight');
  });

  it('SERIF_CARD is a string with font-serif + base size', () => {
    expect(typeof SERIF_CARD).toBe('string');
    expect(SERIF_CARD).toContain('font-serif');
    expect(SERIF_CARD).toContain('font-medium');
    expect(SERIF_CARD).toContain('text-base');
  });

  it('MONO_CHIP is a string with font-mono + chip metrics', () => {
    expect(typeof MONO_CHIP).toBe('string');
    expect(MONO_CHIP).toContain('font-mono');
    expect(MONO_CHIP).toContain('text-[11px]');
    expect(MONO_CHIP).toContain('uppercase');
    expect(MONO_CHIP).toContain('tracking-wide');
  });

  it('MONO_META is a string with font-mono + muted color', () => {
    expect(typeof MONO_META).toBe('string');
    expect(MONO_META).toContain('font-mono');
    expect(MONO_META).toContain('text-[10px]');
    expect(MONO_META).toContain('text-muted-foreground');
  });

  it('SERIF_FONT_STYLE is an inline-style object pointing at the serif var', () => {
    expect(typeof SERIF_FONT_STYLE).toBe('object');
    expect(SERIF_FONT_STYLE).not.toBeNull();
    expect(SERIF_FONT_STYLE.fontFamily).toBeTypeOf('string');
    expect(SERIF_FONT_STYLE.fontFamily).toContain('var(--font-serif)');
    expect(SERIF_FONT_STYLE.fontFamily).toContain('Newsreader');
  });
});
