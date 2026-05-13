import { describe, expect, it } from 'vitest';

import { nextTheme, themeLabel } from '@/lib/theme-cycle';

describe('nextTheme', () => {
  it('advances light to dark', () => {
    expect(nextTheme('light')).toBe('dark');
  });

  it('advances dark to system', () => {
    expect(nextTheme('dark')).toBe('system');
  });

  it('advances system to light (cycle wraps)', () => {
    expect(nextTheme('system')).toBe('light');
  });

  it('returns to start after three steps', () => {
    expect(nextTheme(nextTheme(nextTheme('light')))).toBe('light');
  });

  it('treats undefined as system so the cycle still advances', () => {
    expect(nextTheme(undefined)).toBe('light');
  });

  it('treats unknown strings as system', () => {
    expect(nextTheme('hot-pink')).toBe('light');
  });

  it('is pure — calling twice with the same input returns the same output', () => {
    expect(nextTheme('light')).toBe(nextTheme('light'));
    expect(nextTheme('dark')).toBe(nextTheme('dark'));
  });
});

describe('themeLabel', () => {
  it('renders human-readable labels', () => {
    expect(themeLabel('light')).toBe('Light');
    expect(themeLabel('dark')).toBe('Dark');
    expect(themeLabel('system')).toBe('System');
  });
});
