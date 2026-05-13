/**
 * Thin PostHog REST API adapter — read-only.
 *
 * Charles uses this to answer founder questions like "how many signups
 * this week?" without shipping a chart library. Event ingestion happens
 * client-side in app code; this adapter only queries.
 *
 * Auth priority:
 *   1. IntegrationConnection (toolkit='posthog', status='active') —
 *      `accessToken` is the personal API key, `accessKey` is the project id,
 *      `metadata.host` is the region host.
 *   2. process.env.POSTHOG_API_KEY / POSTHOG_PROJECT_ID / POSTHOG_HOST.
 *
 * Throws when API key or project id can't be resolved.
 */

import { supabase } from '@/lib/supabase';

const DEFAULT_HOST = 'https://us.posthog.com';

export interface PostHogConfig {
  host: string;
  apiKey: string;
  projectId: string;
}

export interface EventCount {
  event: string;
  count: number;
}

export interface TrendPoint {
  day: string;
  count: number;
}

export interface FunnelStep {
  event: string;
  count: number;
  conversionFromPrevious: number;
}

interface PostHogConnectionRow {
  accessToken?: string | null;
  accessKey?: string | null;
  metadata?: { host?: string | null } | null;
}

export async function posthogGetConfig(spaceId: string): Promise<PostHogConfig> {
  const { data } = await supabase
    .from('IntegrationConnection')
    .select('accessToken, accessKey, metadata')
    .eq('spaceId', spaceId)
    .eq('toolkit', 'posthog')
    .eq('status', 'active')
    .maybeSingle();

  const row = (data as PostHogConnectionRow | null) ?? null;

  const apiKey = row?.accessToken || process.env.POSTHOG_API_KEY;
  const projectId = row?.accessKey || process.env.POSTHOG_PROJECT_ID;
  const host = row?.metadata?.host || process.env.POSTHOG_HOST || DEFAULT_HOST;

  if (!apiKey || !projectId) {
    throw new Error(
      `PostHog: no API key or project id found for space ${spaceId}. ` +
        `Connect PostHog in Settings → Integrations, or set POSTHOG_API_KEY and POSTHOG_PROJECT_ID.`,
    );
  }

  return { host: host.replace(/\/$/, ''), apiKey, projectId };
}

function authHeaders(apiKey: string): HeadersInit {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
}

async function readOrThrow(res: Response, action: string): Promise<unknown> {
  if (!res.ok) {
    let body: { detail?: string; error?: string; message?: string } = {};
    try {
      body = (await res.json()) as { detail?: string; error?: string; message?: string };
    } catch {
      // ignore
    }
    const msg = body.detail ?? body.error ?? body.message ?? (await res.text().catch(() => ''));
    throw new Error(`PostHog ${action} failed: ${res.status} — ${msg}`);
  }
  return res.json();
}

function clampDays(days: number | undefined, fallback = 30): number {
  const d = Math.floor(days ?? fallback);
  if (!Number.isFinite(d) || d < 1) return 1;
  if (d > 365) return 365;
  return d;
}

function clampLimit(limit: number | undefined, fallback = 10): number {
  const l = Math.floor(limit ?? fallback);
  if (!Number.isFinite(l) || l < 1) return 1;
  if (l > 50) return 50;
  return l;
}

async function hogql(
  cfg: PostHogConfig,
  query: string,
  action: string,
): Promise<{ columns: string[]; results: unknown[][] }> {
  // Uses POST /api/projects/:id/query/ with kind=HogQLQuery — simplest
  // surface to count + group rows without the trends-insight machinery.
  const res = await fetch(`${cfg.host}/api/projects/${cfg.projectId}/query/`, {
    method: 'POST',
    headers: authHeaders(cfg.apiKey),
    body: JSON.stringify({ query: { kind: 'HogQLQuery', query } }),
  });
  const data = (await readOrThrow(res, action)) as {
    columns?: string[];
    results?: unknown[][];
  };
  return { columns: data.columns ?? [], results: data.results ?? [] };
}

// ── Operations ───────────────────────────────────────────────────────────────

// HogQL: cheaper than POST /insights/trend for a single scalar.
export async function posthogEventCount(
  spaceId: string,
  event: string,
  days = 30,
): Promise<number> {
  const cfg = await posthogGetConfig(spaceId);
  const d = clampDays(days);
  const safeEvent = event.replace(/'/g, "''");
  const q =
    `SELECT count() FROM events WHERE event = '${safeEvent}' ` +
    `AND timestamp >= now() - INTERVAL ${d} DAY`;
  const { results } = await hogql(cfg, q, 'eventCount');
  const row = results[0];
  const n = row && typeof row[0] === 'number' ? row[0] : 0;
  return n;
}

// HogQL: GROUP BY event ORDER BY count — cleaner than the trends endpoint
// for an unbounded set of events.
export async function posthogTopEvents(
  spaceId: string,
  opts: { days?: number; limit?: number } = {},
): Promise<EventCount[]> {
  const cfg = await posthogGetConfig(spaceId);
  const d = clampDays(opts.days);
  const l = clampLimit(opts.limit);
  const q =
    `SELECT event, count() AS c FROM events ` +
    `WHERE timestamp >= now() - INTERVAL ${d} DAY ` +
    `GROUP BY event ORDER BY c DESC LIMIT ${l}`;
  const { results } = await hogql(cfg, q, 'topEvents');
  return results.map((row) => ({
    event: String(row[0] ?? ''),
    count: typeof row[1] === 'number' ? row[1] : Number(row[1] ?? 0),
  }));
}

// HogQL: count(distinct distinct_id) — one scalar, no trend series.
export async function posthogActiveUsers(spaceId: string, days = 30): Promise<number> {
  const cfg = await posthogGetConfig(spaceId);
  const d = clampDays(days);
  const q =
    `SELECT count(DISTINCT distinct_id) FROM events ` +
    `WHERE timestamp >= now() - INTERVAL ${d} DAY`;
  const { results } = await hogql(cfg, q, 'activeUsers');
  const row = results[0];
  return row && typeof row[0] === 'number' ? row[0] : 0;
}

// HogQL: bucket per day so the dashboard can render a tidy sparkline
// without parsing a trends response shape.
export async function posthogSignupsTrend(
  spaceId: string,
  days = 30,
): Promise<TrendPoint[]> {
  const cfg = await posthogGetConfig(spaceId);
  const d = clampDays(days);
  const q =
    `SELECT toDate(timestamp) AS day, count() AS c FROM events ` +
    `WHERE event = 'user signed up' ` +
    `AND timestamp >= now() - INTERVAL ${d} DAY ` +
    `GROUP BY day ORDER BY day ASC`;
  const { results } = await hogql(cfg, q, 'signupsTrend');
  return results.map((row) => ({
    day: String(row[0] ?? ''),
    count: typeof row[1] === 'number' ? row[1] : Number(row[1] ?? 0),
  }));
}

// HogQL: per-step counts then derive conversion in code — the funnel insight
// endpoint adds breakdowns we don't need.
export async function posthogFunnel(
  spaceId: string,
  events: string[],
  days = 30,
): Promise<FunnelStep[]> {
  const cfg = await posthogGetConfig(spaceId);
  const clean = events.map((e) => e.trim()).filter(Boolean);
  if (clean.length === 0) return [];
  const d = clampDays(days);

  const counts: number[] = [];
  for (const ev of clean) {
    const safe = ev.replace(/'/g, "''");
    const q =
      `SELECT count(DISTINCT distinct_id) FROM events ` +
      `WHERE event = '${safe}' ` +
      `AND timestamp >= now() - INTERVAL ${d} DAY`;
    const { results } = await hogql(cfg, q, `funnel step "${ev}"`);
    const row = results[0];
    counts.push(row && typeof row[0] === 'number' ? row[0] : 0);
  }

  return clean.map((event, i) => {
    const count = counts[i] ?? 0;
    const prev = i === 0 ? count : counts[i - 1] ?? 0;
    const conversion = i === 0 ? 1 : prev > 0 ? count / prev : 0;
    return { event, count, conversionFromPrevious: conversion };
  });
}
