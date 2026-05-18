/**
 * Catalog tests for the agent-template builder.
 *
 * Tiny static data, big invariants: the trigger list and the role list
 * are wired into a CHECK constraint at the DB level. If either drifts,
 * inserts start failing in prod — so we pin shape, values, and types here.
 */

import { describe, it, expect } from 'vitest';
import {
  TRIGGER_TYPES,
  SUBAGENT_ROLES,
  isTriggerType,
  isSubAgentRole,
} from '@/lib/agent-templates/catalog';

describe('TRIGGER_TYPES', () => {
  it('ships exactly four trigger types', () => {
    expect(TRIGGER_TYPES).toHaveLength(4);
  });

  it('covers manual, schedule, webhook, event', () => {
    const types = TRIGGER_TYPES.map((t) => t.type).sort();
    expect(types).toEqual(['event', 'manual', 'schedule', 'webhook']);
  });

  it('each trigger carries a label and a description (non-empty)', () => {
    for (const t of TRIGGER_TYPES) {
      expect(typeof t.label).toBe('string');
      expect(t.label.length).toBeGreaterThan(0);
      expect(typeof t.description).toBe('string');
      expect(t.description.length).toBeGreaterThan(0);
    }
  });

  it('manual is listed first (the default)', () => {
    expect(TRIGGER_TYPES[0].type).toBe('manual');
  });

  it('isTriggerType narrows correctly', () => {
    expect(isTriggerType('manual')).toBe(true);
    expect(isTriggerType('schedule')).toBe(true);
    expect(isTriggerType('webhook')).toBe(true);
    expect(isTriggerType('event')).toBe(true);
    expect(isTriggerType('cron')).toBe(false);
    expect(isTriggerType('')).toBe(false);
    expect(isTriggerType(null)).toBe(false);
    expect(isTriggerType(undefined)).toBe(false);
    expect(isTriggerType(42)).toBe(false);
  });
});

describe('SUBAGENT_ROLES', () => {
  it('ships exactly six roles', () => {
    expect(SUBAGENT_ROLES).toHaveLength(6);
  });

  it('contains the documented roles in the documented order', () => {
    expect([...SUBAGENT_ROLES]).toEqual([
      'research',
      'planning',
      'copywriting',
      'review',
      'execution',
      'synthesis',
    ]);
  });

  it('isSubAgentRole accepts every catalog role', () => {
    for (const r of SUBAGENT_ROLES) {
      expect(isSubAgentRole(r)).toBe(true);
    }
  });

  it('isSubAgentRole rejects everything else', () => {
    expect(isSubAgentRole('writer')).toBe(false);
    expect(isSubAgentRole('Research')).toBe(false); // case-sensitive
    expect(isSubAgentRole('')).toBe(false);
    expect(isSubAgentRole(null)).toBe(false);
    expect(isSubAgentRole(undefined)).toBe(false);
    expect(isSubAgentRole(7)).toBe(false);
  });
});
