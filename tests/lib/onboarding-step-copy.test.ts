/**
 * Pin the 10-screen onboarding STEPS contract: ordering, kinds, fields,
 * option vocabularies. These tests are the wall between the wizard UI
 * and the /api/onboarding/complete enums — they fail loudly if either
 * side drifts.
 *
 * Voice notes (Jobs lens): sentence case, period at the end on declarative
 * headlines, question marks on questions, no banned vocabulary.
 */

import { describe, it, expect } from 'vitest';
import {
  STEPS,
  STEP_IDS,
  TOTAL_STEPS,
  STAGE_OPTIONS,
  ROLE_OPTIONS,
  EXPERIENCE_OPTIONS,
  stepChip,
} from '@/app/onboarding/step-copy';

describe('STEPS — ordering', () => {
  it('has exactly 10 steps', () => {
    expect(STEPS.length).toBe(10);
    expect(TOTAL_STEPS).toBe(10);
  });

  it('STEP_IDS lists each step id in order', () => {
    expect(STEP_IDS).toEqual([
      'intro',
      'name',
      'stage',
      'role',
      'experience',
      'companyName',
      'whatBuilding',
      'targetCustomer',
      'github',
      'done',
    ]);
  });

  it('starts on intro', () => {
    expect(STEPS[0].id).toBe('intro');
    expect(STEPS[0].kind).toBe('intro');
  });

  it('ends on done', () => {
    expect(STEPS[STEPS.length - 1].id).toBe('done');
    expect(STEPS[STEPS.length - 1].kind).toBe('done');
  });

  it('places the GitHub step second-to-last', () => {
    expect(STEPS[STEPS.length - 2].id).toBe('github');
    expect(STEPS[STEPS.length - 2].kind).toBe('github');
  });
});

describe('STEPS — kinds and fields', () => {
  it('stage step is a scrubber bound to the `stage` field', () => {
    const step = STEPS.find((s) => s.id === 'stage')!;
    expect(step.kind).toBe('scrubber');
    expect(step.field).toBe('stage');
    expect(step.stages).toBeDefined();
  });

  it('role step is options bound to the `role` field', () => {
    const step = STEPS.find((s) => s.id === 'role')!;
    expect(step.kind).toBe('options');
    expect(step.field).toBe('role');
    expect(step.options).toBeDefined();
  });

  it('experience step is options bound to `technicalExperience`', () => {
    const step = STEPS.find((s) => s.id === 'experience')!;
    expect(step.kind).toBe('options');
    expect(step.field).toBe('technicalExperience');
  });

  it('name / companyName are text steps', () => {
    expect(STEPS.find((s) => s.id === 'name')!.kind).toBe('text');
    expect(STEPS.find((s) => s.id === 'companyName')!.kind).toBe('text');
  });

  it('whatBuilding / targetCustomer are textarea steps', () => {
    expect(STEPS.find((s) => s.id === 'whatBuilding')!.kind).toBe('textarea');
    expect(STEPS.find((s) => s.id === 'targetCustomer')!.kind).toBe('textarea');
  });
});

describe('STEPS — CTA labels', () => {
  it('intro CTA is "Continue"', () => {
    expect(STEPS.find((s) => s.id === 'intro')!.ctaLabel).toBe('Continue');
  });

  it('stage CTA is "Next"', () => {
    expect(STEPS.find((s) => s.id === 'stage')!.ctaLabel).toBe('Next');
  });

  it('done CTA is "Enter workspace"', () => {
    expect(STEPS.find((s) => s.id === 'done')!.ctaLabel).toBe(
      'Enter workspace',
    );
  });
});

describe('STAGE_OPTIONS', () => {
  it('exposes exactly the 7 stages in canonical order', () => {
    expect(STAGE_OPTIONS.map((s) => s.value)).toEqual([
      'pre-idea',
      'idea',
      'pre-mvp',
      'mvp',
      'customers',
      'revenue',
      'public',
    ]);
  });

  it('each option has a human label', () => {
    for (const o of STAGE_OPTIONS) {
      expect(o.label.length).toBeGreaterThan(0);
    }
  });
});

describe('ROLE_OPTIONS', () => {
  it('exposes exactly the 8 roles', () => {
    expect(ROLE_OPTIONS.map((r) => r.id)).toEqual([
      'product',
      'engineering',
      'design',
      'marketing',
      'sales',
      'operations',
      'founder',
      'other',
    ]);
  });

  it('founder role label includes "Executive"', () => {
    const founder = ROLE_OPTIONS.find((r) => r.id === 'founder')!;
    expect(founder.label).toContain('Executive');
  });
});

describe('EXPERIENCE_OPTIONS', () => {
  it('exposes exactly the 3 experience levels', () => {
    expect(EXPERIENCE_OPTIONS.map((e) => e.id)).toEqual([
      'writes-code',
      'manages-engineers',
      'non-technical',
    ]);
  });

  it('writes-code option is phrased first-person', () => {
    const it_ = EXPERIENCE_OPTIONS.find((e) => e.id === 'writes-code')!;
    expect(it_.label.toLowerCase()).toContain('i ');
  });
});

describe('STEPS — copy hygiene', () => {
  it('every step has a non-empty headline', () => {
    for (const s of STEPS) {
      expect(s.headline.length).toBeGreaterThan(0);
    }
  });

  it('no headline uses banned vocabulary', () => {
    const banned = [
      'revolutionary',
      'unleash',
      'supercharge',
      '10x',
      'magic',
      'AI-powered',
      'game-changing',
      'paradigm',
      'seamless',
      'leverage',
      'empower',
      'next-gen',
      'cutting-edge',
    ];
    for (const s of STEPS) {
      const sub = (s as { subheadline?: string }).subheadline ?? '';
      const blob = `${s.headline} ${sub}`.toLowerCase();
      for (const word of banned) {
        expect(blob).not.toContain(word.toLowerCase());
      }
    }
  });

  it('no headline contains emoji', () => {
    for (const s of STEPS) {
      expect(s.headline).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
    }
  });
});

describe('stepChip', () => {
  it('renders 1-indexed chip strings against the new 10-step total', () => {
    expect(stepChip(0)).toBe('step 1 / 10');
    expect(stepChip(9)).toBe('step 10 / 10');
  });

  it('is lowercase (mono chip convention)', () => {
    expect(stepChip(0)).toBe(stepChip(0).toLowerCase());
  });
});
