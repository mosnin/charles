/**
 * Per-department page config — pins the keyword classifier behaviour for
 * Engineering. The classifier is heuristic v1; when this map is replaced
 * by a structured `category` field on AgentActivityLog.metadata, these
 * tests come with it.
 */
import { describe, it, expect } from 'vitest';
import {
  getDepartmentPageConfig,
  DEPARTMENT_PAGE_CONFIGS,
  _internals,
} from '@/lib/departments/page-config';

describe('getDepartmentPageConfig', () => {
  it('returns the Engineering config', () => {
    const c = getDepartmentPageConfig('engineering');
    expect(c).not.toBeNull();
    expect(c!.filters.map((f) => f.slug)).toEqual([
      'repos',
      'deploys',
      'env',
      'database',
    ]);
    expect(c!.toolkits.map((t) => t.toolkit).sort()).toEqual(
      ['cloudflare', 'github', 'supabase_target', 'vercel'].sort(),
    );
  });

  it('returns null for departments not yet on the template', () => {
    expect(getDepartmentPageConfig('marketing')).toBeNull();
    expect(getDepartmentPageConfig('sales')).toBeNull();
  });
});

describe('Engineering classifier', () => {
  const eng = _internals.ENGINEERING_CONFIG;

  it('routes PR / repo / commit / branch language to repos', () => {
    expect(eng.classify('Opened pull request #42 on charles/web')).toBe('repos');
    expect(eng.classify('Committed a fix to the main branch')).toBe('repos');
    expect(eng.classify('Created a new repo')).toBe('repos');
  });

  it('routes deploy / vercel / build language to deploys', () => {
    expect(eng.classify('Deployed charles to production')).toBe('deploys');
    expect(eng.classify('Triggered a Vercel build')).toBe('deploys');
  });

  it('routes dns / cloudflare / env language to env', () => {
    expect(eng.classify('Updated DNS record charles.app A 1.2.3.4')).toBe('env');
    expect(eng.classify('Set environment variable POSTGRES_URL on Vercel')).toBe('env');
    expect(eng.classify('Added a Cloudflare CNAME')).toBe('env');
  });

  it('routes migration / supabase / schema language to database', () => {
    expect(eng.classify('Staged Supabase migration adding email column')).toBe(
      'database',
    );
    expect(eng.classify('Modified the table schema')).toBe('database');
  });

  it('falls back to general when nothing matches', () => {
    expect(eng.classify('Did some research')).toBe('general');
    expect(eng.classify('')).toBe('general');
  });

  it('database wins over deploys when both appear', () => {
    // Order matters in the classifier — database is more specific.
    expect(eng.classify('Staged migration before the next deploy')).toBe('database');
  });
});

describe('DEPARTMENT_PAGE_CONFIGS coverage', () => {
  it('only Engineering is wired for now (phase 5 adds the rest)', () => {
    expect(Object.keys(DEPARTMENT_PAGE_CONFIGS)).toEqual(['engineering']);
  });
});
