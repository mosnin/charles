/**
 * Catalog tests for workspace templates.
 *
 * Pin shape, slugs, and the cross-catalog invariants:
 *   - Every recommendedIntegration toolkit exists in the integrations catalog.
 *   - Every extraGates stage is a real Stage from lib/stages/catalog.
 *   - Every documentSeeds slug is a real DocumentSlug.
 *   - getWorkspaceTemplate roundtrips and returns null for unknown slugs.
 */

import { describe, it, expect } from 'vitest';
import {
  WORKSPACE_TEMPLATES,
  WORKSPACE_TEMPLATE_SLUGS,
  getWorkspaceTemplate,
  isWorkspaceTemplateSlug,
  type WorkspaceTemplateSlug,
} from '@/lib/workspace-templates/catalog';
import { INTEGRATIONS } from '@/lib/integrations/catalog';
import { STAGE_ORDER } from '@/lib/stages/catalog';
import { ALL_DOCUMENT_SLUGS } from '@/lib/documents/catalog';

const expectedSlugs: WorkspaceTemplateSlug[] = [
  'saas-b2b',
  'consumer-marketplace',
  'b2b-agency',
  'open-source',
  'physical-product',
];

describe('WORKSPACE_TEMPLATES', () => {
  it('ships exactly five templates', () => {
    expect(WORKSPACE_TEMPLATES).toHaveLength(5);
  });

  it('exposes each documented slug', () => {
    const slugs = WORKSPACE_TEMPLATES.map((t) => t.slug).sort();
    expect(slugs).toEqual([...expectedSlugs].sort());
  });

  it('WORKSPACE_TEMPLATE_SLUGS lines up with the catalog', () => {
    expect([...WORKSPACE_TEMPLATE_SLUGS].sort()).toEqual(
      WORKSPACE_TEMPLATES.map((t) => t.slug).sort(),
    );
  });

  it('every template has a non-empty name and blurb', () => {
    for (const t of WORKSPACE_TEMPLATES) {
      expect(t.name).toBeTruthy();
      expect(t.blurb).toBeTruthy();
      expect(t.name.length).toBeGreaterThan(0);
      expect(t.blurb.length).toBeGreaterThan(0);
    }
  });

  it('every template has 3-5 highlight chips', () => {
    for (const t of WORKSPACE_TEMPLATES) {
      expect(t.highlights.length).toBeGreaterThanOrEqual(3);
      expect(t.highlights.length).toBeLessThanOrEqual(5);
    }
  });

  it('mission seeds use only the allowed mission fields', () => {
    const allowed = new Set([
      'title',
      'oneLinePitch',
      'targetCustomer',
      'productDescription',
    ]);
    for (const t of WORKSPACE_TEMPLATES) {
      for (const key of Object.keys(t.mission)) {
        expect(allowed.has(key)).toBe(true);
      }
    }
  });

  it('every coreMemorySeed value is a non-empty string', () => {
    for (const t of WORKSPACE_TEMPLATES) {
      for (const [slot, value] of Object.entries(t.coreMemorySeeds)) {
        expect(typeof slot).toBe('string');
        expect(slot.length).toBeGreaterThan(0);
        expect(typeof value).toBe('string');
        expect((value as string).length).toBeGreaterThan(0);
      }
    }
  });

  it('every recommendedIntegrations toolkit exists in the integrations catalog', () => {
    const known = new Set(INTEGRATIONS.map((a) => a.toolkit));
    for (const t of WORKSPACE_TEMPLATES) {
      for (const toolkit of t.recommendedIntegrations) {
        expect(known.has(toolkit)).toBe(true);
      }
    }
  });

  it('every extraGates stage is a real Stage', () => {
    const validStages = new Set(STAGE_ORDER);
    for (const t of WORKSPACE_TEMPLATES) {
      for (const stage of Object.keys(t.extraGates)) {
        expect(validStages.has(stage as (typeof STAGE_ORDER)[number])).toBe(true);
      }
    }
  });

  it('every extraGates title is a non-empty string', () => {
    for (const t of WORKSPACE_TEMPLATES) {
      for (const titles of Object.values(t.extraGates)) {
        if (!titles) continue;
        for (const title of titles) {
          expect(typeof title).toBe('string');
          expect(title.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it('every documentSeeds slug is in the documents catalog', () => {
    const validSlugs = new Set(ALL_DOCUMENT_SLUGS);
    for (const t of WORKSPACE_TEMPLATES) {
      for (const slug of Object.keys(t.documentSeeds)) {
        expect(validSlugs.has(slug as (typeof ALL_DOCUMENT_SLUGS)[number])).toBe(true);
      }
    }
  });

  it('documentSeeds content is meaningful (>20 chars)', () => {
    for (const t of WORKSPACE_TEMPLATES) {
      for (const [slug, content] of Object.entries(t.documentSeeds)) {
        expect(typeof content).toBe('string');
        expect((content ?? '').length).toBeGreaterThan(20);
        // Should look like markdown — a heading or list helps.
        expect(content).toMatch(/[#\-*]/);
        // sanity reference so the linter doesn't strip slug
        expect(slug).toBeTruthy();
      }
    }
  });

  it('saas-b2b carries the documented core memory defaults', () => {
    const t = getWorkspaceTemplate('saas-b2b');
    expect(t).not.toBeNull();
    expect(t!.coreMemorySeeds.pricing_model).toBe('subscription');
    expect(t!.coreMemorySeeds.gtm_motion).toBe('outbound');
  });

  it('consumer-marketplace uses take-rate + community', () => {
    const t = getWorkspaceTemplate('consumer-marketplace');
    expect(t).not.toBeNull();
    expect(t!.coreMemorySeeds.pricing_model).toBe('take-rate');
    expect(t!.coreMemorySeeds.gtm_motion).toBe('community');
  });

  it('open-source uses developer-led GTM', () => {
    const t = getWorkspaceTemplate('open-source');
    expect(t).not.toBeNull();
    expect(t!.coreMemorySeeds.gtm_motion).toBe('developer-led');
  });
});

describe('getWorkspaceTemplate', () => {
  it('roundtrips every catalog slug', () => {
    for (const slug of WORKSPACE_TEMPLATE_SLUGS) {
      const t = getWorkspaceTemplate(slug);
      expect(t).not.toBeNull();
      expect(t!.slug).toBe(slug);
    }
  });

  it('returns null for unknown slugs', () => {
    expect(getWorkspaceTemplate('nope')).toBeNull();
    expect(getWorkspaceTemplate('')).toBeNull();
    expect(getWorkspaceTemplate('Saas-B2B')).toBeNull(); // case-sensitive
  });
});

describe('isWorkspaceTemplateSlug', () => {
  it('accepts every catalog slug', () => {
    for (const slug of WORKSPACE_TEMPLATE_SLUGS) {
      expect(isWorkspaceTemplateSlug(slug)).toBe(true);
    }
  });

  it('rejects everything else', () => {
    expect(isWorkspaceTemplateSlug('nope')).toBe(false);
    expect(isWorkspaceTemplateSlug('')).toBe(false);
    expect(isWorkspaceTemplateSlug(null)).toBe(false);
    expect(isWorkspaceTemplateSlug(undefined)).toBe(false);
    expect(isWorkspaceTemplateSlug(42)).toBe(false);
    expect(isWorkspaceTemplateSlug({ slug: 'saas-b2b' })).toBe(false);
  });
});
