/**
 * Documents catalog — invariants the rest of the system depends on.
 *
 * The catalog is the source of truth for the nine workspace documents and
 * their grouping. The migration's CHECK constraint, the seed function, the
 * GET API route, and the index page all derive their behaviour from this
 * file. If any of these invariants break, those callers break with them.
 */

import { describe, it, expect } from 'vitest';
import {
  DOCUMENTS,
  ALL_DOCUMENT_SLUGS,
  GROUP_LABELS,
  GROUP_BLURBS,
  GROUP_ORDER,
  getDocument,
  documentsByGroup,
  type DocumentGroup,
} from '@/lib/documents/catalog';

describe('DOCUMENTS — shape', () => {
  it('has exactly nine entries', () => {
    expect(DOCUMENTS).toHaveLength(9);
  });

  it('has unique slugs across all entries', () => {
    const slugs = DOCUMENTS.map((d) => d.slug);
    const unique = new Set(slugs);
    expect(unique.size).toBe(slugs.length);
  });

  it('exposes every slug via ALL_DOCUMENT_SLUGS in the same order', () => {
    expect(ALL_DOCUMENT_SLUGS).toEqual(DOCUMENTS.map((d) => d.slug));
  });

  it('has a non-empty title on every entry', () => {
    for (const doc of DOCUMENTS) {
      expect(doc.title.trim().length).toBeGreaterThan(0);
    }
  });

  it('has a non-empty blurb on every entry', () => {
    for (const doc of DOCUMENTS) {
      expect(doc.blurb.trim().length).toBeGreaterThan(0);
    }
  });

  it('lists the catalog in catalog-spec order (mission, identity, strategy, execution)', () => {
    const expected = [
      'executive-summary',
      'business-plan',
      'brand-kit',
      'pitch-deck',
      'business-model-canvas',
      'growth-blueprint',
      'product-prd',
      'sales-plan',
      'marketing-plan',
    ];
    expect(DOCUMENTS.map((d) => d.slug)).toEqual(expected);
  });
});

describe('DOCUMENTS — grouping', () => {
  it('groups exactly: mission(2) + identity(2) + strategy(2) + execution(3)', () => {
    const counts: Record<DocumentGroup, number> = {
      mission: 0,
      identity: 0,
      strategy: 0,
      execution: 0,
    };
    for (const doc of DOCUMENTS) counts[doc.group] += 1;
    expect(counts).toEqual({
      mission: 2,
      identity: 2,
      strategy: 2,
      execution: 3,
    });
  });

  it('assigns each entry to one of the four documented groups', () => {
    const allowed: DocumentGroup[] = ['mission', 'identity', 'strategy', 'execution'];
    for (const doc of DOCUMENTS) {
      expect(allowed).toContain(doc.group);
    }
  });

  it('GROUP_ORDER lists the four groups, mission first, execution last', () => {
    expect(GROUP_ORDER).toEqual(['mission', 'identity', 'strategy', 'execution']);
  });

  it('GROUP_LABELS provides a non-empty label for every group in GROUP_ORDER', () => {
    for (const group of GROUP_ORDER) {
      expect(GROUP_LABELS[group].trim().length).toBeGreaterThan(0);
    }
  });

  it('GROUP_BLURBS provides a non-empty blurb for every group in GROUP_ORDER', () => {
    for (const group of GROUP_ORDER) {
      expect(GROUP_BLURBS[group].trim().length).toBeGreaterThan(0);
    }
  });
});

describe('getDocument', () => {
  it('returns the right entry for every catalogue slug', () => {
    for (const doc of DOCUMENTS) {
      const found = getDocument(doc.slug);
      expect(found).toBeDefined();
      expect(found?.slug).toBe(doc.slug);
      expect(found?.title).toBe(doc.title);
    }
  });

  it('returns undefined for an unknown slug', () => {
    expect(getDocument('nope')).toBeUndefined();
    expect(getDocument('')).toBeUndefined();
  });
});

describe('documentsByGroup', () => {
  it('returns exactly four group keys', () => {
    const grouped = documentsByGroup();
    expect(Object.keys(grouped).sort()).toEqual(
      ['execution', 'identity', 'mission', 'strategy'].sort(),
    );
  });

  it('the four groups together contain all nine documents', () => {
    const grouped = documentsByGroup();
    const total =
      grouped.mission.length +
      grouped.identity.length +
      grouped.strategy.length +
      grouped.execution.length;
    expect(total).toBe(9);
  });

  it('preserves catalog ordering within each group', () => {
    const grouped = documentsByGroup();
    expect(grouped.mission.map((d) => d.slug)).toEqual([
      'executive-summary',
      'business-plan',
    ]);
    expect(grouped.identity.map((d) => d.slug)).toEqual(['brand-kit', 'pitch-deck']);
    expect(grouped.strategy.map((d) => d.slug)).toEqual([
      'business-model-canvas',
      'growth-blueprint',
    ]);
    expect(grouped.execution.map((d) => d.slug)).toEqual([
      'product-prd',
      'sales-plan',
      'marketing-plan',
    ]);
  });

  it('every grouped entry round-trips through getDocument', () => {
    const grouped = documentsByGroup();
    for (const group of GROUP_ORDER) {
      for (const doc of grouped[group]) {
        expect(getDocument(doc.slug)?.group).toBe(group);
      }
    }
  });
});
