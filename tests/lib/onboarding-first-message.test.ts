/**
 * The first-run message is the trust deposit. These tests pin the parts
 * that, if broken, would make Charles sound generic on the most important
 * screen in the product: name in the greeting, stage in the reflection,
 * one concrete move, the bridge to Tasks. Phrasing inside each stage can
 * drift freely — what matters is the shape.
 */

import { describe, it, expect } from 'vitest';
import { buildFirstMessage } from '@/lib/onboarding/first-message';

describe('buildFirstMessage', () => {
  it('uses the founder name in the greeting when provided', () => {
    const out = buildFirstMessage({ founderName: 'Sam', ideaStage: 'idea' });
    expect(out.messageContent).toMatch(/^Welcome, Sam\./);
  });

  it('falls back to a name-less welcome when no name is given', () => {
    const out = buildFirstMessage({ ideaStage: 'idea' });
    expect(out.messageContent).toMatch(/^Welcome\./);
  });

  it('mentions the one-line pitch when present', () => {
    const out = buildFirstMessage({
      founderName: 'Sam',
      ideaStage: 'pre-mvp',
      oneLinePitch: 'a CRM for solo realtors',
    });
    expect(out.messageContent).toContain('a CRM for solo realtors');
  });

  it('always points the user toward the Tasks tab', () => {
    const out = buildFirstMessage({ founderName: 'Sam', ideaStage: 'public' });
    expect(out.messageContent).toMatch(/Tasks/);
  });

  it('returns a non-trivial task title for every stage', () => {
    const stages = ['pre-idea', 'idea', 'pre-mvp', 'mvp', 'customers', 'revenue', 'public'] as const;
    for (const stage of stages) {
      const out = buildFirstMessage({ founderName: 'Sam', ideaStage: stage });
      expect(out.firstTaskTitle.length).toBeGreaterThan(10);
      expect(out.firstTaskTitle.length).toBeLessThan(120);
    }
  });

  it('reflects the pre-idea stage as searching for what to build', () => {
    const out = buildFirstMessage({ founderName: 'Sam', ideaStage: 'pre-idea' });
    expect(out.messageContent).toMatch(/pre-idea/i);
  });

  it('reflects the pre-mvp stage as building the smallest version', () => {
    const out = buildFirstMessage({ founderName: 'Sam', ideaStage: 'pre-mvp' });
    expect(out.messageContent.toLowerCase()).toMatch(/pre-mvp|smallest version|cut for v1/);
  });

  it('reflects the mvp stage as already having something built', () => {
    const out = buildFirstMessage({ founderName: 'Sam', ideaStage: 'mvp' });
    expect(out.messageContent.toLowerCase()).toMatch(/mvp/);
  });

  it('reflects the revenue stage as already making money', () => {
    const out = buildFirstMessage({ founderName: 'Sam', ideaStage: 'revenue' });
    expect(out.messageContent.toLowerCase()).toMatch(/making money|product is real/);
  });

  it('uses the generic fallback when ideaStage is null', () => {
    const out = buildFirstMessage({ founderName: 'Sam' });
    expect(out.messageContent).toMatch(/second brain/);
    expect(out.firstTaskTitle).toMatch(/ship/);
  });

  it('returns a conversation title that fits in a sidebar row', () => {
    const out = buildFirstMessage({ founderName: 'Sam', ideaStage: 'idea' });
    expect(out.conversationTitle.length).toBeLessThan(40);
  });
});
