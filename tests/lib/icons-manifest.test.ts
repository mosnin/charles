/**
 * Tests for the pixel-art icon manifest at `lib/icons/manifest.ts`.
 *
 * Asserts the shape of the maps + the fallback behavior of the resolver
 * functions. The icon SVGs themselves live under `public/icons/` and aren't
 * loaded here — these tests pin the contract, not the artwork.
 */

import { describe, it, expect } from 'vitest';

import {
  STAGE_GATE_ICONS,
  DEPARTMENT_ICONS,
  iconForStageGate,
  iconForDepartment,
} from '@/lib/icons/manifest';

describe('STAGE_GATE_ICONS', () => {
  it('has at least 10 entries — covers most of the catalog', () => {
    const keys = Object.keys(STAGE_GATE_ICONS);
    expect(keys.length).toBeGreaterThanOrEqual(10);
  });

  it('every entry points at an /icons/*.svg path', () => {
    for (const [key, path] of Object.entries(STAGE_GATE_ICONS)) {
      expect(path, `entry ${key}`).toMatch(/^\/icons\/[a-z0-9-]+\.svg$/);
    }
  });

  it('connects core idea-stage gates to expected icons', () => {
    expect(STAGE_GATE_ICONS['connect-github']).toBe('/icons/github.svg');
    expect(STAGE_GATE_ICONS['define-your-company-in-one-sentence']).toBe(
      '/icons/idea.svg',
    );
    expect(STAGE_GATE_ICONS['identify-your-target-customer']).toBe(
      '/icons/target-customer.svg',
    );
  });
});

describe('DEPARTMENT_ICONS', () => {
  it('has all 6 dept slugs', () => {
    const expected = [
      'engineering',
      'sales',
      'marketing',
      'design',
      'support',
      'ops_finance',
    ];
    for (const slug of expected) {
      expect(DEPARTMENT_ICONS).toHaveProperty(slug);
    }
    expect(Object.keys(DEPARTMENT_ICONS)).toHaveLength(6);
  });

  it('every dept entry points at /icons/dept-*.svg', () => {
    for (const [slug, path] of Object.entries(DEPARTMENT_ICONS)) {
      expect(path, `entry ${slug}`).toMatch(/^\/icons\/dept-[a-z-]+\.svg$/);
    }
  });
});

describe('iconForStageGate', () => {
  it('returns the mapped icon for known gate titles (case + spacing insensitive)', () => {
    expect(iconForStageGate('Connect GitHub')).toBe('/icons/github.svg');
    expect(iconForStageGate('connect github')).toBe('/icons/github.svg');
    expect(iconForStageGate('  Connect   GitHub  ')).toBe('/icons/github.svg');
  });

  it('falls back to idea.svg for unknown gates', () => {
    expect(iconForStageGate('totally fictional gate')).toBe('/icons/idea.svg');
    expect(iconForStageGate('')).toBe('/icons/idea.svg');
  });
});

describe('iconForDepartment', () => {
  it('returns the mapped icon for each dept slug', () => {
    expect(iconForDepartment('engineering')).toBe('/icons/dept-engineering.svg');
    expect(iconForDepartment('sales')).toBe('/icons/dept-sales.svg');
    expect(iconForDepartment('ops_finance')).toBe('/icons/dept-ops-finance.svg');
  });

  it('falls back to engineering for unknown slugs', () => {
    expect(iconForDepartment('not-a-dept')).toBe('/icons/dept-engineering.svg');
    expect(iconForDepartment('')).toBe('/icons/dept-engineering.svg');
  });
});
