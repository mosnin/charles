/**
 * Pin onboarding step copy — labels, ordering, and the chip string.
 *
 * These tests are about the Charles voice: sentence case, period at the
 * end, founder-readable. They're also a guard against silent reorders of
 * STEP_IDS that would scramble the GitHub step out of the last slot.
 */

import { describe, it, expect } from 'vitest';
import {
  STEP_IDS,
  STEP_COPY,
  TOTAL_STEPS,
  stepChip,
} from '@/app/onboarding/step-copy';

describe('STEP_IDS', () => {
  it('has exactly four steps in fixed order', () => {
    expect(STEP_IDS).toEqual(['company', 'idea', 'github', 'template']);
    expect(TOTAL_STEPS).toBe(4);
  });

  it('ends with the template step (the optional starting-point picker)', () => {
    expect(STEP_IDS[STEP_IDS.length - 1]).toBe('template');
  });

  it('puts the GitHub connector step just before the optional template step', () => {
    const githubIdx = STEP_IDS.indexOf('github');
    expect(githubIdx).toBe(STEP_IDS.length - 2);
  });
});

describe('STEP_COPY', () => {
  it('has copy for every step id', () => {
    for (const id of STEP_IDS) {
      expect(STEP_COPY[id]).toBeDefined();
      expect(STEP_COPY[id].title.length).toBeGreaterThan(0);
      expect(STEP_COPY[id].subtitle.length).toBeGreaterThan(0);
    }
  });

  it('every title ends in a period (Charles voice)', () => {
    for (const id of STEP_IDS) {
      expect(STEP_COPY[id].title.endsWith('.')).toBe(true);
    }
  });

  it('every title starts uppercase, sentence case (no Title Case)', () => {
    for (const id of STEP_IDS) {
      const title = STEP_COPY[id].title;
      // First char uppercase
      expect(title[0]).toBe(title[0].toUpperCase());
      // No exclamation marks, no emoji
      expect(title).not.toMatch(/[!]/);
      expect(title).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
    }
  });

  it('every subtitle ends in a period', () => {
    for (const id of STEP_IDS) {
      expect(STEP_COPY[id].subtitle.endsWith('.')).toBe(true);
    }
  });

  it('field-bearing steps preserve the API contract field keys', () => {
    // The /api/onboarding/complete endpoint expects these exact keys.
    expect(STEP_COPY.company.fields?.map((f) => f.key)).toEqual([
      'companyName',
      'tagline',
      'founderName',
    ]);
    expect(STEP_COPY.idea.fields?.map((f) => f.key)).toEqual([
      'whatBuilding',
      'oneLinePitch',
      'targetCustomer',
    ]);
  });

  it('GitHub step has no fields (it is a connector step)', () => {
    expect(STEP_COPY.github.fields).toBeUndefined();
  });

  it('template step has no fields (it is a picker step)', () => {
    expect(STEP_COPY.template.fields).toBeUndefined();
  });

  it('max-length caps match the existing form contract', () => {
    const company = STEP_COPY.company.fields ?? [];
    expect(company.find((f) => f.key === 'companyName')?.maxLength).toBe(120);
    expect(company.find((f) => f.key === 'tagline')?.maxLength).toBe(200);
    expect(company.find((f) => f.key === 'founderName')?.maxLength).toBe(120);

    const idea = STEP_COPY.idea.fields ?? [];
    expect(idea.find((f) => f.key === 'whatBuilding')?.maxLength).toBe(800);
    expect(idea.find((f) => f.key === 'whatBuilding')?.multiline).toBe(true);
  });

  it('does not use banned vocabulary', () => {
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
    for (const id of STEP_IDS) {
      const blob =
        `${STEP_COPY[id].title} ${STEP_COPY[id].subtitle} ` +
        (STEP_COPY[id].fields ?? [])
          .map((f) => `${f.label} ${f.placeholder}`)
          .join(' ');
      for (const word of banned) {
        expect(blob.toLowerCase()).not.toContain(word.toLowerCase());
      }
    }
  });
});

describe('stepChip', () => {
  it('renders 1-indexed chip strings', () => {
    expect(stepChip(0)).toBe('step 1 / 4');
    expect(stepChip(1)).toBe('step 2 / 4');
    expect(stepChip(2)).toBe('step 3 / 4');
    expect(stepChip(3)).toBe('step 4 / 4');
  });

  it('is lowercase (mono chip convention)', () => {
    expect(stepChip(0)).toBe(stepChip(0).toLowerCase());
  });
});
