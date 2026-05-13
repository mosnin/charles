/**
 * Pin the dept workflows registry — the shape, the slugs, the lookups.
 * If a new tab is added or a default goes stale, the test yells first.
 */

import { describe, it, expect } from 'vitest';
import {
  DEPARTMENT_CONFIGS,
  getDepartmentConfig,
  getDepartmentTab,
} from '@/lib/departments/workflows';
import { ALL_DEPARTMENTS } from '@/lib/departments/autonomy';

describe('DEPARTMENT_CONFIGS', () => {
  it('covers every department slug from autonomy with no extras', () => {
    expect(Object.keys(DEPARTMENT_CONFIGS).sort()).toEqual(
      [...ALL_DEPARTMENTS].sort(),
    );
  });

  it('every config has a non-empty name, blurb, and tab list', () => {
    for (const slug of ALL_DEPARTMENTS) {
      const cfg = DEPARTMENT_CONFIGS[slug];
      expect(cfg.name.length).toBeGreaterThan(0);
      expect(cfg.blurb.length).toBeGreaterThan(0);
      expect(cfg.tabs.length).toBeGreaterThan(0);
    }
  });

  it('every config.defaultTab is one of its own tab slugs', () => {
    for (const slug of ALL_DEPARTMENTS) {
      const cfg = DEPARTMENT_CONFIGS[slug];
      const tabSlugs = cfg.tabs.map((t) => t.slug);
      expect(tabSlugs).toContain(cfg.defaultTab);
    }
  });

  it('every tab has a non-empty slug and label', () => {
    for (const slug of ALL_DEPARTMENTS) {
      for (const tab of DEPARTMENT_CONFIGS[slug].tabs) {
        expect(tab.slug.length).toBeGreaterThan(0);
        expect(tab.label.length).toBeGreaterThan(0);
      }
    }
  });

  it('tab slugs are unique within each department', () => {
    for (const slug of ALL_DEPARTMENTS) {
      const tabSlugs = DEPARTMENT_CONFIGS[slug].tabs.map((t) => t.slug);
      expect(new Set(tabSlugs).size).toBe(tabSlugs.length);
    }
  });

  it('sales has the four cofounder.co tabs in order', () => {
    const sales = DEPARTMENT_CONFIGS.sales;
    expect(sales.tabs.map((t) => t.slug)).toEqual([
      'enrich',
      'research',
      'outreach',
      'campaigns',
    ]);
    expect(sales.tabs.map((t) => t.label)).toEqual([
      'Enrich contacts',
      'Research contacts',
      'Send Outreach Emails',
      'Campaigns',
    ]);
    expect(sales.defaultTab).toBe('enrich');
  });
});

describe('getDepartmentConfig', () => {
  it('returns the config for every valid slug', () => {
    for (const slug of ALL_DEPARTMENTS) {
      const cfg = getDepartmentConfig(slug);
      expect(cfg).not.toBeNull();
      expect(cfg?.slug).toBe(slug);
    }
  });

  it('returns null on an unknown slug', () => {
    expect(getDepartmentConfig('legal')).toBeNull();
    expect(getDepartmentConfig('')).toBeNull();
    expect(getDepartmentConfig('SALES')).toBeNull(); // case-sensitive
  });

  it('does not return a config for prototype-pollution-style lookups', () => {
    expect(getDepartmentConfig('__proto__')).toBeNull();
    expect(getDepartmentConfig('constructor')).toBeNull();
    expect(getDepartmentConfig('toString')).toBeNull();
  });
});

describe('getDepartmentTab', () => {
  it('returns the tab for a valid (dept, tab) pair', () => {
    const tab = getDepartmentTab('sales', 'enrich');
    expect(tab).not.toBeNull();
    expect(tab?.slug).toBe('enrich');
    expect(tab?.label).toBe('Enrich contacts');
  });

  it('roundtrips every tab in every department', () => {
    for (const slug of ALL_DEPARTMENTS) {
      const cfg = DEPARTMENT_CONFIGS[slug];
      for (const tab of cfg.tabs) {
        const found = getDepartmentTab(slug, tab.slug);
        expect(found).toEqual(tab);
      }
    }
  });

  it('returns null when the department slug is unknown', () => {
    expect(getDepartmentTab('legal', 'whatever')).toBeNull();
  });

  it('returns null when the tab slug is unknown for a real department', () => {
    expect(getDepartmentTab('sales', 'pipeline')).toBeNull();
    expect(getDepartmentTab('sales', '')).toBeNull();
  });

  it('returns null when the default tab is queried with the wrong case', () => {
    // We are case-sensitive on purpose — URLs are case-sensitive.
    expect(getDepartmentTab('sales', 'ENRICH')).toBeNull();
  });
});
