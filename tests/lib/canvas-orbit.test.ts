/**
 * Pin the orbit math and clockwise placement order. These two decisions are
 * the spine of the home canvas — when someone tweaks the radius or adds a
 * seventh department, the test should be the thing that yells first.
 */

import { describe, it, expect } from 'vitest';
import {
  ORBIT_ORDER,
  orbitPoint,
  orbitPoints,
  clockPosition,
} from '@/lib/canvas/orbit';
import { ALL_DEPARTMENTS } from '@/lib/departments/autonomy';

describe('ORBIT_ORDER', () => {
  it('contains exactly six departments', () => {
    expect(ORBIT_ORDER.length).toBe(6);
  });

  it('covers every department in lib/departments/autonomy (no extras, no gaps)', () => {
    expect([...ORBIT_ORDER].sort()).toEqual([...ALL_DEPARTMENTS].sort());
  });

  it('starts at marketing (12 o\'clock) and ends at design (10 o\'clock)', () => {
    expect(ORBIT_ORDER[0]).toBe('marketing');
    expect(ORBIT_ORDER[5]).toBe('design');
  });

  it('places engineering at the foundation (6 o\'clock, index 3)', () => {
    expect(ORBIT_ORDER[3]).toBe('engineering');
  });
});

describe('orbitPoint', () => {
  const R = 200;

  it('puts index 0 at the top (x≈0, y≈-R)', () => {
    const p = orbitPoint(0, 6, R);
    expect(Math.abs(p.x)).toBeLessThan(1e-9);
    expect(p.y).toBeCloseTo(-R, 6);
  });

  it('puts index 3 of 6 at the bottom (x≈0, y≈+R)', () => {
    const p = orbitPoint(3, 6, R);
    expect(Math.abs(p.x)).toBeLessThan(1e-9);
    expect(p.y).toBeCloseTo(R, 6);
  });

  it('advances clockwise — index 1 of 6 lands top-right (x>0, y<0)', () => {
    const p = orbitPoint(1, 6, R);
    expect(p.x).toBeGreaterThan(0);
    expect(p.y).toBeLessThan(0);
  });

  it('keeps every node on the ring: x^2 + y^2 ≈ R^2', () => {
    for (let i = 0; i < 6; i++) {
      const p = orbitPoint(i, 6, R);
      expect(p.x * p.x + p.y * p.y).toBeCloseTo(R * R, 4);
    }
  });

  it('rejects total <= 0', () => {
    expect(() => orbitPoint(0, 0, R)).toThrow();
  });
});

describe('orbitPoints', () => {
  it('returns six points, one per department, in ORBIT_ORDER positions', () => {
    const pts = orbitPoints(220);
    expect(pts.length).toBe(6);
    // The first point is top (matches ORBIT_ORDER[0] === 'marketing').
    expect(Math.abs(pts[0].x)).toBeLessThan(1e-9);
    expect(pts[0].y).toBeCloseTo(-220, 6);
  });

  it('spaces all six nodes equally (≈60° between neighbours)', () => {
    const pts = orbitPoints(200);
    for (let i = 1; i < pts.length; i++) {
      const delta = pts[i].angle - pts[i - 1].angle;
      expect(delta).toBeCloseTo((2 * Math.PI) / 6, 6);
    }
  });
});

describe('clockPosition', () => {
  it('labels the six dept slots clockwise from the top', () => {
    const labels = orbitPoints(200).map((p) => clockPosition(p.angle));
    expect(labels).toEqual([
      'top',
      'top-right',
      'bottom-right',
      'bottom',
      'bottom-left',
      'top-left',
    ]);
  });
});
