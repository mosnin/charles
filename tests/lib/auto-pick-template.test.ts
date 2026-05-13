/**
 * Pin the founder-stage → workspace-template mapping.
 *
 * The 10-screen onboarding flow drops the explicit template picker and
 * relies on this map. Every existing catalog slug stays a valid target;
 * we never invent new slugs from the stage signal.
 */

import { describe, it, expect } from 'vitest';
import {
  autoPickTemplateForStage,
  DEFAULT_AUTO_PICK_SLUG,
  FOUNDER_IDEA_STAGES,
  isFounderIdeaStage,
  type FounderIdeaStage,
} from '@/lib/workspace-templates/auto-pick';
import { WORKSPACE_TEMPLATE_SLUGS } from '@/lib/workspace-templates/catalog';

describe('autoPickTemplateForStage', () => {
  it('maps pre-idea → open-source', () => {
    expect(autoPickTemplateForStage('pre-idea')).toBe('open-source');
  });

  it('maps idea → open-source', () => {
    expect(autoPickTemplateForStage('idea')).toBe('open-source');
  });

  it('maps pre-mvp → saas-b2b', () => {
    expect(autoPickTemplateForStage('pre-mvp')).toBe('saas-b2b');
  });

  it('maps mvp → saas-b2b', () => {
    expect(autoPickTemplateForStage('mvp')).toBe('saas-b2b');
  });

  it('maps customers → consumer-marketplace', () => {
    expect(autoPickTemplateForStage('customers')).toBe('consumer-marketplace');
  });

  it('maps revenue → b2b-agency', () => {
    expect(autoPickTemplateForStage('revenue')).toBe('b2b-agency');
  });

  it('maps public → physical-product', () => {
    expect(autoPickTemplateForStage('public')).toBe('physical-product');
  });

  it('undefined → DEFAULT_AUTO_PICK_SLUG', () => {
    expect(autoPickTemplateForStage(undefined)).toBe(DEFAULT_AUTO_PICK_SLUG);
  });

  it('every mapped slug is in the official catalog', () => {
    for (const stage of FOUNDER_IDEA_STAGES) {
      const slug = autoPickTemplateForStage(stage);
      expect(WORKSPACE_TEMPLATE_SLUGS).toContain(slug);
    }
  });

  it('never returns an empty string', () => {
    for (const stage of FOUNDER_IDEA_STAGES) {
      expect(autoPickTemplateForStage(stage)).not.toBe('');
    }
  });
});

describe('FOUNDER_IDEA_STAGES', () => {
  it('exposes exactly the seven stages in canonical order', () => {
    expect(FOUNDER_IDEA_STAGES).toEqual([
      'pre-idea',
      'idea',
      'pre-mvp',
      'mvp',
      'customers',
      'revenue',
      'public',
    ]);
  });
});

describe('isFounderIdeaStage', () => {
  it('returns true for every canonical stage', () => {
    for (const stage of FOUNDER_IDEA_STAGES) {
      expect(isFounderIdeaStage(stage)).toBe(true);
    }
  });

  it('returns false for unknown strings', () => {
    expect(isFounderIdeaStage('unicorn')).toBe(false);
    expect(isFounderIdeaStage('')).toBe(false);
  });

  it('returns false for non-string inputs', () => {
    expect(isFounderIdeaStage(null)).toBe(false);
    expect(isFounderIdeaStage(undefined)).toBe(false);
    expect(isFounderIdeaStage(42)).toBe(false);
    expect(isFounderIdeaStage({})).toBe(false);
  });

  it('narrows the type at compile time', () => {
    const x: unknown = 'mvp';
    if (isFounderIdeaStage(x)) {
      const _ok: FounderIdeaStage = x;
      expect(_ok).toBe('mvp');
    }
  });
});
