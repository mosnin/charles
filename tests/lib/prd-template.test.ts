/**
 * Tests for the PRD prompt template — pure builders, no I/O.
 *
 * We lock the system-prompt invariants (six sections, fixed order, markdown
 * only) and the user-prompt redaction rules (null/empty collapse to "(not set)",
 * labels exact, core memory slots only when present).
 */

import { describe, it, expect } from 'vitest';
import {
  buildPrdSystemPrompt,
  buildPrdUserPrompt,
  type PrdInput,
} from '@/lib/documents/prd-template';

function fullInput(overrides: Partial<PrdInput> = {}): PrdInput {
  return {
    workspaceName: 'Acme Robotics',
    missionTitle: 'Build the home robot that does the dishes.',
    oneLinePitch: 'Pinch-grasp dishes off any counter, into any rack.',
    targetCustomer: 'Households with a dishwasher and zero patience.',
    productDescription: 'Tabletop arm + vision model + dishrack profile.',
    brandVoice: 'Direct, dry, never cute.',
    coreMemorySlots: {
      company_name: 'Acme Robotics',
      stage: 'building',
    },
    ...overrides,
  };
}

describe('buildPrdSystemPrompt', () => {
  const prompt = buildPrdSystemPrompt();

  it('names the role plainly', () => {
    expect(prompt).toMatch(/Product Requirement Document/);
  });

  it('demands markdown only with no preamble', () => {
    expect(prompt).toMatch(/markdown only/i);
    expect(prompt).toMatch(/single `#` title/);
  });

  it('lists all six required sections in order', () => {
    const idxProblem = prompt.indexOf('Problem');
    const idxCustomer = prompt.indexOf('Customer');
    const idxSolution = prompt.indexOf('Solution');
    const idxScope = prompt.indexOf('Scope');
    const idxSuccess = prompt.indexOf('Success metrics');
    const idxRisks = prompt.indexOf('Risks');
    expect(idxProblem).toBeGreaterThan(-1);
    expect(idxCustomer).toBeGreaterThan(idxProblem);
    expect(idxSolution).toBeGreaterThan(idxCustomer);
    expect(idxScope).toBeGreaterThan(idxSolution);
    expect(idxSuccess).toBeGreaterThan(idxScope);
    expect(idxRisks).toBeGreaterThan(idxSuccess);
  });

  it('names the v1-in / v1-out scope subsections', () => {
    expect(prompt).toMatch(/v1 in/);
    expect(prompt).toMatch(/v1 out/);
  });

  it('targets 400-700 words for the body', () => {
    expect(prompt).toMatch(/400 to 700 words/);
  });

  it('bans the usual marketing words', () => {
    expect(prompt).toMatch(/leverage/);
    expect(prompt).toMatch(/synergy/);
    expect(prompt).toMatch(/world-class/);
  });
});

describe('buildPrdUserPrompt', () => {
  it('emits labeled fields in the documented order', () => {
    const out = buildPrdUserPrompt(fullInput());
    const idxWorkspace = out.indexOf('Workspace:');
    const idxMission = out.indexOf('Mission:');
    const idxPitch = out.indexOf('One-line pitch:');
    const idxCustomer = out.indexOf('Target customer:');
    const idxProduct = out.indexOf('Product description:');
    const idxVoice = out.indexOf('Brand voice:');
    expect(idxWorkspace).toBeGreaterThan(-1);
    expect(idxMission).toBeGreaterThan(idxWorkspace);
    expect(idxPitch).toBeGreaterThan(idxMission);
    expect(idxCustomer).toBeGreaterThan(idxPitch);
    expect(idxProduct).toBeGreaterThan(idxCustomer);
    expect(idxVoice).toBeGreaterThan(idxProduct);
  });

  it('redacts null fields to "(not set)"', () => {
    const out = buildPrdUserPrompt(
      fullInput({
        missionTitle: null,
        oneLinePitch: null,
        targetCustomer: null,
        productDescription: null,
        brandVoice: null,
      }),
    );
    expect(out).toMatch(/Mission: \(not set\)/);
    expect(out).toMatch(/One-line pitch: \(not set\)/);
    expect(out).toMatch(/Target customer: \(not set\)/);
    expect(out).toMatch(/Product description: \(not set\)/);
    expect(out).toMatch(/Brand voice: \(not set\)/);
  });

  it('redacts empty / whitespace-only fields the same way', () => {
    const out = buildPrdUserPrompt(
      fullInput({
        missionTitle: '   ',
        oneLinePitch: '',
        targetCustomer: '\t\n',
      }),
    );
    expect(out).toMatch(/Mission: \(not set\)/);
    expect(out).toMatch(/One-line pitch: \(not set\)/);
    expect(out).toMatch(/Target customer: \(not set\)/);
  });

  it('omits the core memory block when no slots are provided', () => {
    const out = buildPrdUserPrompt(fullInput({ coreMemorySlots: {} }));
    expect(out).not.toMatch(/Core memory slots:/);
  });

  it('includes each core memory slot when present', () => {
    const out = buildPrdUserPrompt(
      fullInput({
        coreMemorySlots: {
          company_name: 'Acme',
          stage: 'building',
          north_star: null,
        },
      }),
    );
    expect(out).toMatch(/Core memory slots:/);
    expect(out).toMatch(/- company_name: Acme/);
    expect(out).toMatch(/- stage: building/);
    expect(out).toMatch(/- north_star: \(not set\)/);
  });

  it('asks for ~400-700 words of markdown', () => {
    const out = buildPrdUserPrompt(fullInput());
    expect(out).toMatch(/400-700 words/);
    expect(out).toMatch(/Markdown only/);
  });

  it('seeds the document title from the mission when available', () => {
    const out = buildPrdUserPrompt(fullInput());
    expect(out).toMatch(/# Build the home robot.* — Product PRD/);
  });

  it('falls back to the workspace name when mission title is null', () => {
    const out = buildPrdUserPrompt(fullInput({ missionTitle: null }));
    expect(out).toMatch(/# Acme Robotics — Product PRD/);
  });

  it('falls back to "Product" when both mission and workspace are empty', () => {
    const out = buildPrdUserPrompt(
      fullInput({ workspaceName: '', missionTitle: null }),
    );
    expect(out).toMatch(/# Product — Product PRD/);
  });

  it('is deterministic — same input, same output', () => {
    const a = buildPrdUserPrompt(fullInput());
    const b = buildPrdUserPrompt(fullInput());
    expect(a).toBe(b);
  });
});
