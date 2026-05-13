/**
 * Pure-function tests for the Charles stage catalog.
 *
 * Guards the catalog invariants (six stages, ordered, non-empty gates,
 * unique titles within a stage) so a quick edit can't silently break
 * the gate seeding path that depends on them.
 */

import { describe, it, expect } from 'vitest';
import {
  STAGES,
  STAGE_ORDER,
  gatesForStage,
  nextStage,
  prevStage,
  type Stage,
} from '@/lib/stages/catalog';

describe('STAGE_ORDER', () => {
  it('is the canonical six-stage sequence', () => {
    expect([...STAGE_ORDER]).toEqual([
      'idea',
      'initial',
      'identity',
      'building',
      'selling',
      'scaling',
    ]);
  });
});

describe('STAGES', () => {
  it('has exactly 6 entries', () => {
    expect(Object.keys(STAGES)).toHaveLength(6);
  });

  it('every STAGE_ORDER slug has a matching STAGES entry with matching slug', () => {
    for (const slug of STAGE_ORDER) {
      const def = STAGES[slug];
      expect(def, `missing entry for ${slug}`).toBeDefined();
      expect(def.slug).toBe(slug);
      expect(def.label.trim().length, `label for ${slug}`).toBeGreaterThan(0);
      expect(def.purpose.trim().length, `purpose for ${slug}`).toBeGreaterThan(0);
    }
  });

  it('every stage has between 3 and 5 gates', () => {
    for (const slug of STAGE_ORDER) {
      const n = STAGES[slug].gates.length;
      expect(n, `gate count for ${slug}`).toBeGreaterThanOrEqual(3);
      expect(n, `gate count for ${slug}`).toBeLessThanOrEqual(5);
    }
  });

  it('all gate titles are non-empty trimmed strings', () => {
    for (const slug of STAGE_ORDER) {
      for (const title of STAGES[slug].gates) {
        expect(typeof title).toBe('string');
        expect(title).toBe(title.trim());
        expect(title.length, `empty title in ${slug}`).toBeGreaterThan(0);
      }
    }
  });

  it('gate titles are unique within each stage', () => {
    for (const slug of STAGE_ORDER) {
      const titles = STAGES[slug].gates;
      expect(new Set(titles).size, `dup titles in ${slug}`).toBe(titles.length);
    }
  });
});

describe('gatesForStage', () => {
  it('returns a non-empty list for every stage', () => {
    for (const slug of STAGE_ORDER) {
      expect(gatesForStage(slug).length, slug).toBeGreaterThan(0);
    }
  });

  it('matches STAGES[stage].gates exactly', () => {
    for (const slug of STAGE_ORDER) {
      expect(gatesForStage(slug)).toEqual(STAGES[slug].gates);
    }
  });
});

describe('nextStage', () => {
  it('returns the next slug for non-terminal stages', () => {
    expect(nextStage('idea')).toBe('initial');
    expect(nextStage('initial')).toBe('identity');
    expect(nextStage('identity')).toBe('building');
    expect(nextStage('building')).toBe('selling');
    expect(nextStage('selling')).toBe('scaling');
  });

  it('returns null at the terminal stage', () => {
    expect(nextStage('scaling')).toBeNull();
  });
});

describe('prevStage', () => {
  it('returns the previous slug for non-initial stages', () => {
    expect(prevStage('scaling')).toBe('selling');
    expect(prevStage('selling')).toBe('building');
    expect(prevStage('initial')).toBe('idea');
  });

  it('returns null at the initial stage', () => {
    expect(prevStage('idea')).toBeNull();
  });
});

describe('Stage type round-trips', () => {
  it('every STAGE_ORDER value is a valid Stage and indexes STAGES', () => {
    // Compile-time check via the `Stage` type: this loop only type-checks
    // if STAGE_ORDER's element type is assignable to Stage.
    const seen = new Set<Stage>();
    for (const s of STAGE_ORDER) {
      seen.add(s);
      expect(STAGES[s]).toBeDefined();
    }
    expect(seen.size).toBe(6);
  });
});
