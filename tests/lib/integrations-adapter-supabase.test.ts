/**
 * Supabase adapter tests — auth resolution, SELECT-only enforcement,
 * happy-path schema reads, error propagation, and stage-only migrations.
 *
 * The adapter targets the FOUNDER's Supabase via /rest/v1/rpc/exec_sql.
 * Stage-migrations write to the platform's own Supabase (mocked here).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { maybeSingleMock, insertMock } = vi.hoisted(() => ({
  maybeSingleMock: vi.fn<() => Promise<{ data: unknown; error: null }>>(),
  insertMock: vi.fn<(...args: unknown[]) => Promise<{ data: null; error: null }>>(),
}));

vi.mock('@/lib/supabase', () => {
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    maybeSingle: maybeSingleMock,
    insert: insertMock,
  };
  return { supabase: { from: vi.fn(() => chain) } };
});

import {
  supabaseListTables,
  supabaseDescribeTable,
  supabaseRunSelect,
  supabaseStageMigration,
} from '@/lib/integrations/adapters/supabase';

const fetchMock = vi.fn<typeof fetch>();
global.fetch = fetchMock as unknown as typeof fetch;

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const ORIG_URL = process.env.SUPABASE_TARGET_URL;
const ORIG_KEY = process.env.SUPABASE_TARGET_SERVICE_KEY;

beforeEach(() => {
  fetchMock.mockReset();
  maybeSingleMock.mockReset();
  insertMock.mockReset();
  maybeSingleMock.mockResolvedValue({ data: null, error: null });
  insertMock.mockResolvedValue({ data: null, error: null });
  delete process.env.SUPABASE_TARGET_URL;
  delete process.env.SUPABASE_TARGET_SERVICE_KEY;
});
afterEach(() => {
  if (ORIG_URL === undefined) delete process.env.SUPABASE_TARGET_URL;
  else process.env.SUPABASE_TARGET_URL = ORIG_URL;
  if (ORIG_KEY === undefined) delete process.env.SUPABASE_TARGET_SERVICE_KEY;
  else process.env.SUPABASE_TARGET_SERVICE_KEY = ORIG_KEY;
});

describe('Supabase adapter — auth', () => {
  it('uses metadata.projectUrl + serviceRoleKey from IntegrationConnection', async () => {
    maybeSingleMock.mockResolvedValue({
      data: {
        metadata: { projectUrl: 'https://abc.supabase.co', serviceRoleKey: 'svc_db' },
      },
      error: null,
    });
    fetchMock.mockResolvedValue(jsonRes([]));
    await supabaseListTables('s1');
    expect(fetchMock.mock.calls[0]![0]).toContain('https://abc.supabase.co/rest/v1/rpc/exec_sql');
    const headers = (fetchMock.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    expect(headers.apikey).toBe('svc_db');
    expect(headers.Authorization).toBe('Bearer svc_db');
  });

  it('falls back to env vars when no IntegrationConnection row', async () => {
    process.env.SUPABASE_TARGET_URL = 'https://env.supabase.co';
    process.env.SUPABASE_TARGET_SERVICE_KEY = 'svc_env';
    fetchMock.mockResolvedValue(jsonRes([]));
    await supabaseListTables('s1');
    expect(fetchMock.mock.calls[0]![0]).toContain('https://env.supabase.co');
  });

  it('throws when neither DB nor env is configured', async () => {
    await expect(supabaseListTables('s1')).rejects.toThrow(/no target/i);
  });
});

describe('Supabase adapter — reads', () => {
  beforeEach(() => {
    process.env.SUPABASE_TARGET_URL = 'https://x.supabase.co';
    process.env.SUPABASE_TARGET_SERVICE_KEY = 'k';
  });

  it('listTables returns table names', async () => {
    fetchMock.mockResolvedValue(jsonRes([{ table_name: 'users' }, { table_name: 'orders' }]));
    const r = await supabaseListTables('s');
    expect(r).toEqual(['users', 'orders']);
  });

  it('describeTable returns columns and indexes', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonRes([
          { column_name: 'id', data_type: 'uuid', is_nullable: 'NO' },
          { column_name: 'email', data_type: 'text', is_nullable: 'YES' },
        ]),
      )
      .mockResolvedValueOnce(jsonRes([{ indexname: 'users_pkey', indexdef: 'CREATE UNIQUE INDEX ...' }]));

    const r = await supabaseDescribeTable('s', 'users');
    expect(r.table).toBe('users');
    expect(r.columns).toEqual([
      { name: 'id', dataType: 'uuid', nullable: false },
      { name: 'email', dataType: 'text', nullable: true },
    ]);
    expect(r.indexes[0]!.name).toBe('users_pkey');
  });

  it('runSelect wraps query with LIMIT cap', async () => {
    fetchMock.mockResolvedValue(jsonRes([{ id: 1 }]));
    await supabaseRunSelect('s', 'select id from users', { limit: 5 });
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.query).toBe('select * from (select id from users) _q limit 5');
  });

  it('runSelect caps requested limit > 100 at 100', async () => {
    fetchMock.mockResolvedValue(jsonRes([]));
    await supabaseRunSelect('s', 'select * from t', { limit: 9999 });
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.query).toMatch(/limit 100$/);
  });
});

describe('Supabase adapter — runSelect rejects non-SELECT', () => {
  beforeEach(() => {
    process.env.SUPABASE_TARGET_URL = 'https://x.supabase.co';
    process.env.SUPABASE_TARGET_SERVICE_KEY = 'k';
  });

  it.each([
    'insert into users values (1)',
    'update users set x=1',
    'delete from users',
    'drop table users',
    'alter table users add column x int',
    'create table foo (id int)',
    'truncate users',
    'grant select on users to anon',
    "select id; drop table users;",
  ])('rejects: %s', async (q) => {
    await expect(supabaseRunSelect('s', q)).rejects.toThrow(/only SELECT|must start with SELECT/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects bare non-select even if it looks innocent', async () => {
    await expect(supabaseRunSelect('s', 'with x as (select 1) select * from x')).rejects.toThrow(
      /must start with SELECT/i,
    );
  });
});

describe('Supabase adapter — errors', () => {
  beforeEach(() => {
    process.env.SUPABASE_TARGET_URL = 'https://x.supabase.co';
    process.env.SUPABASE_TARGET_SERVICE_KEY = 'k';
  });

  it('throws with message on non-2xx', async () => {
    fetchMock.mockResolvedValue(jsonRes({ message: 'function not found' }, 404));
    await expect(supabaseListTables('s')).rejects.toThrow(/404.*function not found/);
  });
});

describe('Supabase adapter — stageMigration', () => {
  it('stages without executing DDL and returns descriptor', async () => {
    const r = await supabaseStageMigration('space_1', {
      name: 'add_users_email_index',
      sql: 'CREATE INDEX ON users(email)',
    });
    expect(r.staged).toBe(true);
    expect(r.name).toBe('add_users_email_index');
    expect(r.sql).toContain('CREATE INDEX');
    expect(r.message).toMatch(/founder must apply/i);
    // No fetch — no DDL executed against the founder's project.
    expect(fetchMock).not.toHaveBeenCalled();
    // Best-effort persistence to platform's own Supabase.
    expect(insertMock).toHaveBeenCalledWith({
      spaceId: 'space_1',
      name: 'add_users_email_index',
      sql: 'CREATE INDEX ON users(email)',
    });
  });

  it('returns descriptor even when StagedMigration table insert throws', async () => {
    insertMock.mockRejectedValue(new Error('relation "StagedMigration" does not exist'));
    const r = await supabaseStageMigration('space_1', { name: 'm', sql: 'CREATE TABLE t(id int)' });
    expect(r.staged).toBe(true);
    expect(r.message).toMatch(/founder must apply/i);
  });
});
