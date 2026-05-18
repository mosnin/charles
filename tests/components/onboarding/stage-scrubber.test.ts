/**
 * Tick math for the stage scrubber. The component is otherwise visual, so we
 * pin the helper's behavior across first/last/middle stages plus boundary
 * inputs (single stage, out-of-range index) — those are the cases most likely
 * to silently drift.
 */
import { describe, it, expect } from 'vitest';
import { tickRangeForStage } from '@/components/onboarding/stage-scrubber';

describe('tickRangeForStage', () => {
  it('covers the first slice for stage 0', () => {
    const { start, end } = tickRangeForStage(0, 5, 50);
    expect(start).toBe(0);
    expect(end).toBe(9);
  });

  it('covers the last slice for the final stage', () => {
    const { start, end } = tickRangeForStage(4, 5, 50);
    expect(start).toBe(40);
    expect(end).toBe(49);
  });

  it('places a middle stage in the middle band', () => {
    const { start, end } = tickRangeForStage(2, 5, 50);
    expect(start).toBe(20);
    expect(end).toBe(29);
  });

  it('puts the dot at the center of the band', () => {
    const { dotPosition } = tickRangeForStage(2, 5, 50);
    expect(dotPosition).toBe(24);
  });

  it('handles a single stage spanning the full ruler', () => {
    const { start, end, dotPosition } = tickRangeForStage(0, 1, 50);
    expect(start).toBe(0);
    expect(end).toBe(49);
    expect(dotPosition).toBe(24);
  });

  it('clamps negative stage indices to the first stage', () => {
    const { start, end } = tickRangeForStage(-3, 5, 50);
    expect(start).toBe(0);
    expect(end).toBe(9);
  });

  it('clamps out-of-range stage indices to the last stage', () => {
    const { start, end } = tickRangeForStage(99, 5, 50);
    expect(start).toBe(40);
    expect(end).toBe(49);
  });

  it('respects a custom totalTicks count', () => {
    const { start, end } = tickRangeForStage(1, 4, 20);
    expect(start).toBe(5);
    expect(end).toBe(9);
  });

  it('returns a usable structure for zero stages', () => {
    const range = tickRangeForStage(0, 0, 50);
    expect(range.start).toBe(0);
    expect(range.end).toBe(0);
    expect(range.dotPosition).toBe(0);
  });

  it('keeps end >= start for any valid input', () => {
    for (let total = 1; total <= 8; total++) {
      for (let i = 0; i < total; i++) {
        const { start, end } = tickRangeForStage(i, total, 50);
        expect(end).toBeGreaterThanOrEqual(start);
      }
    }
  });
});
