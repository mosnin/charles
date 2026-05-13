import { describe, it, expect } from 'vitest';
import {
  COMMAND_GROUPS,
  COMMAND_ITEMS,
  matchCommands,
} from '@/lib/command-palette';

describe('COMMAND_ITEMS catalog', () => {
  it('has roughly the expected size', () => {
    // ~20 items: 8 Workspace nav + 3 Create + 8 Settings + 1 Account = 20.
    expect(COMMAND_ITEMS.length).toBeGreaterThanOrEqual(18);
    expect(COMMAND_ITEMS.length).toBeLessThanOrEqual(24);
  });

  it('all ids are unique', () => {
    const ids = COMMAND_ITEMS.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every declared group has at least one item', () => {
    for (const g of COMMAND_GROUPS) {
      const items = COMMAND_ITEMS.filter((i) => i.group === g);
      expect(items.length, `group ${g}`).toBeGreaterThan(0);
    }
  });

  it('every item belongs to a declared group', () => {
    for (const item of COMMAND_ITEMS) {
      expect(COMMAND_GROUPS).toContain(item.group);
    }
  });

  it('nav items carry an href; action items carry an action', () => {
    for (const item of COMMAND_ITEMS) {
      if (item.kind === 'nav') {
        expect(item.href, item.id).toBeDefined();
      } else if (item.kind === 'action') {
        expect(item.action, item.id).toBeDefined();
      }
    }
  });

  it('nav hrefs are slug-relative (no /s/ prefix)', () => {
    for (const item of COMMAND_ITEMS) {
      if (item.href !== undefined) {
        expect(item.href.startsWith('/s/'), item.id).toBe(false);
        if (item.href.length > 0) {
          expect(item.href.startsWith('/'), item.id).toBe(true);
        }
      }
    }
  });

  it('every item has an icon', () => {
    for (const item of COMMAND_ITEMS) {
      expect(item.icon).toBeDefined();
    }
  });
});

describe('matchCommands', () => {
  it('returns the full catalog for an empty query', () => {
    expect(matchCommands('').length).toBe(COMMAND_ITEMS.length);
    expect(matchCommands('   ').length).toBe(COMMAND_ITEMS.length);
  });

  it('finds Tasks by label', () => {
    const hits = matchCommands('task');
    expect(hits.some((i) => i.id === 'tasks')).toBe(true);
  });

  it('finds Documents by label', () => {
    const hits = matchCommands('document');
    expect(hits.some((i) => i.id === 'documents')).toBe(true);
  });

  it('is case insensitive', () => {
    const lower = matchCommands('chat');
    const upper = matchCommands('CHAT');
    const mixed = matchCommands('ChAt');
    expect(lower.map((i) => i.id)).toEqual(upper.map((i) => i.id));
    expect(lower.map((i) => i.id)).toEqual(mixed.map((i) => i.id));
    expect(lower.some((i) => i.id === 'chat')).toBe(true);
  });

  it('matches against keywords (todo finds Tasks)', () => {
    const hits = matchCommands('todo');
    expect(hits.some((i) => i.id === 'tasks')).toBe(true);
  });

  it('matches keywords on Settings entries (subscription finds Billing)', () => {
    const hits = matchCommands('subscription');
    expect(hits.some((i) => i.id === 'settings-billing')).toBe(true);
  });

  it('matches keywords on Sign out (logout finds it)', () => {
    const hits = matchCommands('logout');
    expect(hits.some((i) => i.id === 'sign-out')).toBe(true);
  });

  it('returns an empty array when nothing matches', () => {
    expect(matchCommands('zzzzz-no-such-thing')).toEqual([]);
  });

  it('finds the chat entry by the legacy "chippi" keyword', () => {
    const hits = matchCommands('chippi');
    expect(hits.some((i) => i.id === 'chat')).toBe(true);
  });

  it('preserves catalog order in results', () => {
    const hits = matchCommands('');
    expect(hits.map((i) => i.id)).toEqual(COMMAND_ITEMS.map((i) => i.id));
  });

  it('trims whitespace from the query', () => {
    expect(matchCommands('  tasks  ').some((i) => i.id === 'tasks')).toBe(true);
  });
});
