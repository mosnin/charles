/**
 * MorningBriefing is a dumb surface — it reads a localStorage date, picks a
 * greeting, and renders two columns from `DailyBriefingData`. Like the
 * approval celebration, the project doesn't ship jsdom / testing-library, so
 * these tests pin the pure logic: the date-gate format (read and write must
 * agree) and the greeting fallback. The visual + the once-per-day behaviour
 * are verified by the moment landing right in product.
 */
import { describe, it, expect } from 'vitest';
import { _internals } from '@/components/canvas/morning-briefing';

const { todayLocal, briefingGreeting, STORAGE_KEY } = _internals;

describe('todayLocal', () => {
  it('formats a date as zero-padded YYYY-MM-DD', () => {
    expect(todayLocal(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(todayLocal(new Date(2026, 11, 31))).toBe('2026-12-31');
  });

  it('is stable for two calls on the same calendar day', () => {
    const morning = new Date(2026, 4, 14, 6, 0, 0);
    const evening = new Date(2026, 4, 14, 23, 30, 0);
    expect(todayLocal(morning)).toBe(todayLocal(evening));
  });

  it('rolls over between calendar days', () => {
    expect(todayLocal(new Date(2026, 4, 14))).not.toBe(todayLocal(new Date(2026, 4, 15)));
  });
});

describe('briefingGreeting', () => {
  it('uses the first name when present', () => {
    expect(briefingGreeting('Jane')).toBe('Good morning, Jane.');
  });

  it('falls back to a plain second-person opener', () => {
    expect(briefingGreeting(null)).toBe('Good morning.');
  });
});

describe('STORAGE_KEY', () => {
  it('is namespaced under charles:', () => {
    expect(STORAGE_KEY).toBe('charles:briefing:last-seen');
  });
});
