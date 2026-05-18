/**
 * String-level contract tests for the Charles department registry.
 *
 * The Python registry in agent/departments/__init__.py is the single source
 * of truth, but TS-side code (UI, integrations catalog) takes opinions on
 * those slugs. These tests pin the contract from the TS side so silent
 * drift between Python and TS surfaces in CI.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const REPO_ROOT = join(__dirname, '..', '..');
const DEPT_DIR = join(REPO_ROOT, 'agent', 'departments');
const REGISTRY_FILE = join(DEPT_DIR, '__init__.py');
const PROMPTS_DIR = join(DEPT_DIR, '_prompts');

const EXPECTED_SLUGS = [
  'engineering',
  'sales',
  'marketing',
  'design',
  'support',
  'ops_finance',
] as const;

function readRegistrySlugs(): string[] {
  const src = readFileSync(REGISTRY_FILE, 'utf8');
  // Capture the DEPARTMENT_REGISTRY = { ... } block
  const blockMatch = src.match(/DEPARTMENT_REGISTRY[^=]*=\s*\{([\s\S]*?)\}/);
  if (!blockMatch) return [];
  const body = blockMatch[1];
  // Each entry: "slug": ClassName
  return [...body.matchAll(/"([a-z_]+)"\s*:/g)].map((m) => m[1]);
}

describe('DEPARTMENT_REGISTRY (Python source)', () => {
  it('contains all 6 expected department slugs', () => {
    const slugs = new Set(readRegistrySlugs());
    for (const expected of EXPECTED_SLUGS) {
      expect(slugs.has(expected), `missing slug: ${expected}`).toBe(true);
    }
    expect(slugs.size).toBe(EXPECTED_SLUGS.length);
  });

  it('every registered slug has a matching <slug>.py module', () => {
    for (const slug of EXPECTED_SLUGS) {
      const path = join(DEPT_DIR, `${slug}.py`);
      expect(existsSync(path), `missing module: ${path}`).toBe(true);
    }
  });

  it('every registered slug has a _prompts/<slug>.md file', () => {
    for (const slug of EXPECTED_SLUGS) {
      const path = join(PROMPTS_DIR, `${slug}.md`);
      expect(existsSync(path), `missing prompt: ${path}`).toBe(true);
    }
  });
});

describe('department tool wiring', () => {
  it('engineering.py imports github + vercel + supabase tools', () => {
    const src = readFileSync(join(DEPT_DIR, 'engineering.py'), 'utf8');
    expect(src).toMatch(/from tools\.engineering\.github import/);
    expect(src).toMatch(/from tools\.engineering\.vercel import/);
    expect(src).toMatch(/from tools\.engineering\.supabase import/);
  });

  it('ops_finance.py imports stripe tools', () => {
    const src = readFileSync(join(DEPT_DIR, 'ops_finance.py'), 'utf8');
    expect(src).toMatch(/from tools\.ops_finance\.stripe import/);
  });
});
