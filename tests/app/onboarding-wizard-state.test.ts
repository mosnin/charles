/**
 * Unit tests for the onboarding wizard's pure helpers.
 *
 * No React, no DOM — these pin validation per step kind, step-index
 * advancement bounds, and the exact payload shape posted to
 * /api/onboarding/complete.
 */

import { describe, expect, it } from 'vitest';
import {
  defaultValues,
  isStepValid,
  nextStepIndex,
  payloadFromValues,
  prevStepIndex,
  type StepShape,
  type WizardValues,
} from '@/app/onboarding/wizard-state';

function vals(overrides: Partial<WizardValues> = {}): WizardValues {
  return { ...defaultValues(), ...overrides };
}

describe('isStepValid', () => {
  it('intro is always valid', () => {
    expect(isStepValid({ kind: 'intro' }, vals())).toBe(true);
  });

  it('done is always valid', () => {
    expect(isStepValid({ kind: 'done' }, vals())).toBe(true);
  });

  it('github is always valid (skip is allowed)', () => {
    expect(isStepValid({ kind: 'github' }, vals())).toBe(true);
  });

  it('text invalid when empty or whitespace', () => {
    const step: StepShape = { kind: 'text', field: 'companyName' };
    expect(isStepValid(step, vals({ companyName: '' }))).toBe(false);
    expect(isStepValid(step, vals({ companyName: '   ' }))).toBe(false);
  });

  it('text valid when non-empty after trim', () => {
    const step: StepShape = { kind: 'text', field: 'companyName' };
    expect(isStepValid(step, vals({ companyName: 'Acme' }))).toBe(true);
    expect(isStepValid(step, vals({ companyName: '  Acme  ' }))).toBe(true);
  });

  it('textarea invalid below 8 trimmed chars', () => {
    const step: StepShape = { kind: 'textarea', field: 'whatBuilding' };
    expect(isStepValid(step, vals({ whatBuilding: 'short' }))).toBe(false);
    expect(isStepValid(step, vals({ whatBuilding: '       ' }))).toBe(false);
  });

  it('textarea valid at exactly 8 trimmed chars', () => {
    const step: StepShape = { kind: 'textarea', field: 'whatBuilding' };
    expect(isStepValid(step, vals({ whatBuilding: 'abcdefgh' }))).toBe(true);
  });

  it('options invalid when empty string', () => {
    const step: StepShape = { kind: 'options', field: 'founderRole' };
    expect(isStepValid(step, vals({ founderRole: '' }))).toBe(false);
  });

  it('options valid when any non-empty id', () => {
    const step: StepShape = { kind: 'options', field: 'founderRole' };
    expect(isStepValid(step, vals({ founderRole: 'founder' }))).toBe(true);
  });

  it('scrubber valid because default ideaStage is seeded', () => {
    const step: StepShape = { kind: 'scrubber', field: 'ideaStage' };
    expect(isStepValid(step, vals())).toBe(true); // default ideaStage = 'idea'
  });

  it('scrubber invalid if ideaStage somehow blanked', () => {
    const step: StepShape = { kind: 'scrubber', field: 'ideaStage' };
    expect(isStepValid(step, vals({ ideaStage: '' }))).toBe(false);
  });

  it('text/textarea/options/scrubber without a field are invalid', () => {
    expect(isStepValid({ kind: 'text' }, vals())).toBe(false);
    expect(isStepValid({ kind: 'textarea' }, vals())).toBe(false);
    expect(isStepValid({ kind: 'options' }, vals())).toBe(false);
    expect(isStepValid({ kind: 'scrubber' }, vals())).toBe(false);
  });
});

describe('nextStepIndex', () => {
  it('advances by one inside the bounds', () => {
    expect(nextStepIndex(0, 10)).toBe(1);
    expect(nextStepIndex(4, 10)).toBe(5);
  });

  it('clamps at the last index', () => {
    expect(nextStepIndex(9, 10)).toBe(9);
    expect(nextStepIndex(100, 10)).toBe(9);
  });

  it('handles zero/negative input safely', () => {
    expect(nextStepIndex(-5, 10)).toBe(0);
    expect(nextStepIndex(0, 0)).toBe(0);
  });
});

describe('prevStepIndex', () => {
  it('walks back by one', () => {
    expect(prevStepIndex(3)).toBe(2);
    expect(prevStepIndex(1)).toBe(0);
  });

  it('clamps at zero', () => {
    expect(prevStepIndex(0)).toBe(0);
    expect(prevStepIndex(-5)).toBe(0);
  });
});

describe('payloadFromValues', () => {
  it('returns the API-shaped payload with trimmed strings', () => {
    const v: WizardValues = {
      founderName: '  Alex Kim  ',
      companyName: ' Acme ',
      whatBuilding: '  An AI cofounder.  ',
      targetCustomer: '  Solo founders.  ',
      ideaStage: 'building',
      founderRole: 'founder',
      technicalExperience: 'technical',
      githubConnected: true,
      githubSkipped: false,
    };
    expect(payloadFromValues(v)).toEqual({
      founderName: 'Alex Kim',
      companyName: 'Acme',
      whatBuilding: 'An AI cofounder.',
      targetCustomer: 'Solo founders.',
      ideaStage: 'building',
      founderRole: 'founder',
      technicalExperience: 'technical',
      githubConnected: true,
    });
  });

  it('excludes githubSkipped from the payload', () => {
    const v = { ...defaultValues(), githubSkipped: true };
    const out = payloadFromValues(v) as unknown as Record<string, unknown>;
    expect('githubSkipped' in out).toBe(false);
  });

  it('keeps githubConnected as a boolean (not coerced)', () => {
    const out = payloadFromValues({ ...defaultValues(), githubConnected: false });
    expect(out.githubConnected).toBe(false);
    expect(typeof out.githubConnected).toBe('boolean');
  });
});

describe('defaultValues', () => {
  it('seeds ideaStage to "idea" so the scrubber has a meaningful default', () => {
    expect(defaultValues().ideaStage).toBe('idea');
  });

  it('uses the supplied founderName from Clerk if given', () => {
    expect(defaultValues('Sam').founderName).toBe('Sam');
  });

  it('booleans default to false', () => {
    const d = defaultValues();
    expect(d.githubConnected).toBe(false);
    expect(d.githubSkipped).toBe(false);
  });
});
