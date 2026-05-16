/**
 * Structural pin on the Convex schema.
 *
 * We don't run Convex itself in the test suite — that requires the
 * `convex dev` daemon. Instead, we import the schema and assert the
 * tables, fields, and indexes match what the rest of the codebase
 * expects. If someone renames a field or drops an index by accident,
 * this fails loudly.
 */

import { describe, it, expect } from 'vitest';
import schema from '@/convex/schema';

type ExportedIndex = { indexDescriptor: string; fields: string[] };
type ExportedDocType = {
  type: 'object';
  value: Record<string, { optional: boolean; fieldType: any }>;
};
type ExportedTable = {
  indexes: ExportedIndex[];
  documentType: ExportedDocType;
};

function exportTable(name: keyof typeof schema.tables): ExportedTable {
  // Convex's defineTable returns an object with a .export() introspection
  // method; this is internal API but stable and used by Convex's own
  // codegen.
  const table = (schema.tables as any)[name];
  return table.export() as ExportedTable;
}

function fieldNames(table: ExportedTable): string[] {
  return Object.keys(table.documentType.value).sort();
}

function indexNames(table: ExportedTable): string[] {
  return table.indexes.map((i) => i.indexDescriptor).sort();
}

function indexFields(table: ExportedTable, name: string): string[] {
  const idx = table.indexes.find((i) => i.indexDescriptor === name);
  if (!idx) throw new Error(`missing index ${name}`);
  return idx.fields;
}

describe('Convex schema shape', () => {
  it('defines exactly four tables', () => {
    expect(Object.keys(schema.tables).sort()).toEqual([
      'canvasActivity',
      'liveMessages',
      'presence',
      'realtimeTicks',
    ]);
  });

  it('presence has the expected fields', () => {
    const t = exportTable('presence');
    expect(fieldNames(t)).toEqual([
      'cursorX',
      'cursorY',
      'lastActiveAt',
      'spaceId',
      'surface',
      'typingConversationId',
      'userId',
      'userImage',
      'userName',
    ]);
  });

  it('presence has by_space and by_space_active indexes', () => {
    const t = exportTable('presence');
    expect(indexNames(t)).toEqual(['by_space', 'by_space_active']);
    expect(indexFields(t, 'by_space')).toEqual(['spaceId']);
    expect(indexFields(t, 'by_space_active')).toEqual([
      'spaceId',
      'lastActiveAt',
    ]);
  });

  it('liveMessages has the expected fields including persistedToSupabase', () => {
    const t = exportTable('liveMessages');
    expect(fieldNames(t)).toEqual([
      'content',
      'conversationId',
      'createdAt',
      'metadata',
      'persistedToSupabase',
      'role',
      'spaceId',
    ]);
  });

  it('liveMessages has by_conversation and by_space indexes', () => {
    const t = exportTable('liveMessages');
    expect(indexNames(t)).toEqual(['by_conversation', 'by_space']);
    expect(indexFields(t, 'by_conversation')).toEqual(['conversationId']);
    expect(indexFields(t, 'by_space')).toEqual(['spaceId']);
  });

  it('canvasActivity has the expected fields including TTL', () => {
    const t = exportTable('canvasActivity');
    expect(fieldNames(t)).toEqual([
      'createdAt',
      'department',
      'expiresAt',
      'kind',
      'spaceId',
      'summary',
    ]);
  });

  it('canvasActivity has by_space and by_space_dept indexes', () => {
    const t = exportTable('canvasActivity');
    expect(indexNames(t)).toEqual(['by_space', 'by_space_dept']);
    expect(indexFields(t, 'by_space')).toEqual(['spaceId']);
    expect(indexFields(t, 'by_space_dept')).toEqual(['spaceId', 'department']);
  });

  it('realtimeTicks has TTL fields + an optional summary', () => {
    const t = exportTable('realtimeTicks');
    expect(fieldNames(t)).toEqual([
      'createdAt',
      'expiresAt',
      'kind',
      'spaceId',
      'summary',
    ]);
    expect(t.documentType.value.summary.optional).toBe(true);
  });

  it('realtimeTicks has by_space and by_space_kind indexes', () => {
    const t = exportTable('realtimeTicks');
    expect(indexNames(t)).toEqual(['by_space', 'by_space_kind']);
    expect(indexFields(t, 'by_space')).toEqual(['spaceId']);
    expect(indexFields(t, 'by_space_kind')).toEqual(['spaceId', 'kind']);
  });

  it('every table has a spaceId field (the join key to Supabase)', () => {
    for (const name of Object.keys(schema.tables)) {
      const t = exportTable(name as keyof typeof schema.tables);
      expect(fieldNames(t)).toContain('spaceId');
    }
  });

  it('optional fields are marked optional in the validator', () => {
    const presence = exportTable('presence');
    expect(presence.documentType.value.cursorX.optional).toBe(true);
    expect(presence.documentType.value.cursorY.optional).toBe(true);
    expect(presence.documentType.value.userImage.optional).toBe(true);
    expect(presence.documentType.value.spaceId.optional).toBe(false);
    expect(presence.documentType.value.userId.optional).toBe(false);
  });

  it('liveMessages.role is a string-literal union of the three roles', () => {
    const t = exportTable('liveMessages');
    const role = t.documentType.value.role.fieldType;
    // Convex serializes unions as { type: 'union', value: [...] }
    expect(role.type).toBe('union');
    const literals = role.value
      .map((v: any) => v.value)
      .sort();
    expect(literals).toEqual(['assistant', 'system', 'user']);
  });
});
