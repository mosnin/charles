/**
 * The numbered option list shows a two-digit index in front of each label.
 * This helper is the only piece of logic in the component; pin it so a
 * "let's drop the leading zero" PR has to opt in on purpose.
 */
import { describe, it, expect } from 'vitest';
import { formatOptionNumber } from '@/components/onboarding/numbered-option-list';

describe('formatOptionNumber', () => {
  it('formats index 0 as 01', () => {
    expect(formatOptionNumber(0)).toBe('01');
  });

  it('formats index 8 as 09', () => {
    expect(formatOptionNumber(8)).toBe('09');
  });

  it('formats index 9 as 10', () => {
    expect(formatOptionNumber(9)).toBe('10');
  });

  it('does not pad beyond two digits', () => {
    expect(formatOptionNumber(99)).toBe('100');
  });
});
