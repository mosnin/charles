/**
 * Radial placement helpers for the canvas home orbit.
 *
 * Pure functions — no React, no DOM. The center page renders six department
 * nodes on a ring around the centerpiece; these helpers turn an index +
 * geometry into an `(x, y)` offset, and own the clockwise placement order.
 */

import { ALL_DEPARTMENTS, type DepartmentSlug } from '@/lib/departments/autonomy';

/**
 * Clockwise placement order, starting from 12 o'clock (top).
 *
 * Marketing leads at the top — it's how a founder finds the world.
 * Engineering is at 6 o'clock — the foundation everything sits on.
 * The money pair (Sales, Ops/Finance) flanks the right.
 * The make pair (Design, Support) flanks the left.
 */
export const ORBIT_ORDER: readonly DepartmentSlug[] = [
  'marketing',
  'sales',
  'ops_finance',
  'engineering',
  'support',
  'design',
] as const;

// Compile-time sanity: orbit order is exactly the six departments, no extras.
const _orbitCoversAllDepartments: Record<DepartmentSlug, true> = Object.fromEntries(
  ORBIT_ORDER.map((s) => [s, true as const]),
) as Record<DepartmentSlug, true>;
void _orbitCoversAllDepartments;
void ALL_DEPARTMENTS;

export interface OrbitPoint {
  x: number;
  y: number;
  /** Angle in radians, 0 = 12 o'clock, increases clockwise. */
  angle: number;
}

/**
 * Return the `(x, y)` offset (in pixels, relative to ring center) for the
 * `index`-th node on a ring of `total` evenly spaced points, with the first
 * point at 12 o'clock and subsequent points placed clockwise.
 *
 * `radius` is the distance from center to node center in pixels.
 *
 * Coordinate convention: +x right, +y down (DOM / SVG).
 */
export function orbitPoint(index: number, total: number, radius: number): OrbitPoint {
  if (total <= 0) {
    throw new Error('orbitPoint: total must be >= 1');
  }
  // Start at -PI/2 (12 o'clock), advance clockwise (positive in DOM y-down).
  const angle = -Math.PI / 2 + (index * 2 * Math.PI) / total;
  return {
    x: radius * Math.cos(angle),
    y: radius * Math.sin(angle),
    angle,
  };
}

/** All six orbit points in clockwise order. */
export function orbitPoints(radius: number): OrbitPoint[] {
  return ORBIT_ORDER.map((_, i) => orbitPoint(i, ORBIT_ORDER.length, radius));
}

/**
 * Human-readable clock position for a given orbit angle. Useful in tests +
 * tooltips. Buckets the circle into 8 sectors.
 */
export function clockPosition(angle: number): string {
  // Normalize to [0, 2π).
  const TAU = 2 * Math.PI;
  const a = ((angle % TAU) + TAU) % TAU;
  // 12 o'clock is at -PI/2 in our convention; normalize so 0 = 12 o'clock.
  const shifted = (a + Math.PI / 2) % TAU;
  const sector = Math.round(shifted / (TAU / 8)) % 8;
  return [
    'top',
    'top-right',
    'right',
    'bottom-right',
    'bottom',
    'bottom-left',
    'left',
    'top-left',
  ][sector];
}
