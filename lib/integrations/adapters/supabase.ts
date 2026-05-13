/**
 * Thin Supabase adapter — targets the FOUNDER'S connected project (NOT
 * Charles's own Supabase).
 *
 * Reads (listTables, describeTable, runSelect) execute against the founder's
 * project via a PostgREST RPC named `exec_sql`. runSelect blocks any DDL/DML
 * keyword and caps LIMIT at 100. Migrations are STAGED only — DDL is never
 * executed by the agent.
 *
 * Auth: IntegrationConnection (toolkit='supabase', metadata.projectUrl +
 * metadata.serviceRoleKey, or accessToken) → SUPABASE_TARGET_URL +
 * SUPABASE_TARGET_SERVICE_KEY env. Throws when neither is set.
 */

import { supabase } from '@/lib/supabase';

const FORBIDDEN_KEYWORDS = /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke)\b/i;

export interface SupabaseTarget {
  url: string;
  key: string;
}

async function getSupabaseTarget(spaceId: string): Promise<SupabaseTarget> {
  const { data } = await supabase
    .from('IntegrationConnection')
    .select('metadata,accessToken')
    .eq('spaceId', spaceId)
    .eq('toolkit', 'supabase')
    .eq('status', 'active')
    .maybeSingle();

  const row = data as
    | { metadata?: Record<string, string>; accessToken?: string }
    | null;
  const meta = row?.metadata ?? {};
  const url = meta.projectUrl ?? meta.project_url;
  const key = meta.serviceRoleKey ?? meta.service_role_key ?? row?.accessToken;
  if (url && key) return { url, key };

  const envUrl = process.env.SUPABASE_TARGET_URL;
  const envKey = process.env.SUPABASE_TARGET_SERVICE_KEY;
  if (envUrl && envKey) return { url: envUrl, key: envKey };

  throw new Error(
    `Supabase: no target project configured for space ${spaceId}. ` +
      `Connect Supabase in Settings → Integrations, or set SUPABASE_TARGET_URL + SUPABASE_TARGET_SERVICE_KEY.`,
  );
}

async function execSql(target: SupabaseTarget, sql: string): Promise<unknown[]> {
  const res = await fetch(`${target.url.replace(/\/$/, '')}/rest/v1/rpc/exec_sql`, {
    method: 'POST',
    headers: {
      apikey: target.key,
      Authorization: `Bearer ${target.key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sql }),
  });
  if (!res.ok) {
    let body: { message?: string; hint?: string } = {};
    try {
      body = (await res.json()) as { message?: string; hint?: string };
    } catch {
      // ignore
    }
    const msg = body.message ?? body.hint ?? (await res.text().catch(() => ''));
    throw new Error(`Supabase execSql failed: ${res.status} — ${msg}`);
  }
  const data = (await res.json()) as unknown;
  if (Array.isArray(data)) return data;
  if (data == null) return [];
  return [data];
}

// ── Operations ───────────────────────────────────────────────────────────────

export async function supabaseListTables(spaceId: string): Promise<string[]> {
  const target = await getSupabaseTarget(spaceId);
  const rows = (await execSql(
    target,
    "select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by table_name",
  )) as Array<{ table_name: string }>;
  return rows.map((r) => r.table_name);
}

export interface ColumnInfo {
  name: string;
  dataType: string;
  nullable: boolean;
}

export interface IndexInfo {
  name: string;
  definition: string;
}

export interface TableDescription {
  table: string;
  columns: ColumnInfo[];
  indexes: IndexInfo[];
}

export async function supabaseDescribeTable(
  spaceId: string,
  table: string,
): Promise<TableDescription> {
  const target = await getSupabaseTarget(spaceId);
  const safe = table.replace(/'/g, "''");

  const cols = (await execSql(
    target,
    `select column_name, data_type, is_nullable from information_schema.columns where table_schema='public' and table_name='${safe}' order by ordinal_position`,
  )) as Array<{ column_name: string; data_type: string; is_nullable: string }>;

  const idxs = (await execSql(
    target,
    `select indexname, indexdef from pg_indexes where schemaname='public' and tablename='${safe}' order by indexname`,
  )) as Array<{ indexname: string; indexdef: string }>;

  return {
    table,
    columns: cols.map((c) => ({
      name: c.column_name,
      dataType: c.data_type,
      nullable: c.is_nullable === 'YES',
    })),
    indexes: idxs.map((i) => ({ name: i.indexname, definition: i.indexdef })),
  };
}

export async function supabaseRunSelect(
  spaceId: string,
  query: string,
  opts?: { limit?: number },
): Promise<unknown[]> {
  if (FORBIDDEN_KEYWORDS.test(query)) {
    throw new Error('Supabase runSelect: only SELECT queries are allowed.');
  }
  if (!/^\s*select\b/i.test(query)) {
    throw new Error('Supabase runSelect: query must start with SELECT.');
  }
  const limit = Math.min(Math.max(opts?.limit ?? 100, 1), 100);
  const target = await getSupabaseTarget(spaceId);
  const wrapped = `select * from (${query.replace(/;\s*$/, '')}) _q limit ${limit}`;
  return execSql(target, wrapped);
}

export interface StagedMigration {
  staged: true;
  name: string;
  sql: string;
  message: string;
}

/**
 * Stage a migration for founder review. DOES NOT EXECUTE DDL.
 *
 * Best-effort writes a row into a `StagedMigration` table on the platform's
 * own Supabase. If that table doesn't exist, this falls back to returning
 * the staged-migration descriptor without persistence — the agent surfaces
 * the SQL to the founder either way.
 */
export async function supabaseStageMigration(
  spaceId: string,
  params: { name: string; sql: string },
): Promise<StagedMigration> {
  try {
    await supabase
      .from('StagedMigration')
      .insert({ spaceId, name: params.name, sql: params.sql });
  } catch {
    // Table may not exist yet; fall through. The string return still
    // surfaces the migration to the founder.
  }
  return {
    staged: true,
    name: params.name,
    sql: params.sql,
    message: `Migration '${params.name}' staged. The founder must apply it after review — no DDL was executed.`,
  };
}
