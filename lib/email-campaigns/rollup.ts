/**
 * Email-campaigns rollup — Resend + Loops, one shape.
 *
 * Pulls recent sends from both providers, normalizes them into
 * CampaignSummary rows, and computes a 30-day overview. Defensive by
 * design: a provider that 404s, 401s, or rate-limits returns [] —
 * never throws into the caller. The dashboard decides what to show.
 *
 * Auth: IntegrationConnection (toolkit='resend' / 'loops') →
 * RESEND_API_KEY / LOOPS_API_KEY env. Throws (inside the try/catch)
 * when neither is set for the provider being queried.
 *
 * Loops note: Loops' public REST API exposes transactional templates
 * and event ingestion, but not a per-template engagement rollup
 * (opens/clicks/bounces). We surface totalSent from /events?eventName=
 * loops_email_sent when available, and leave open/click/bounce at 0.
 * We DO NOT fabricate numbers we don't have.
 */

import { supabase } from '@/lib/supabase';

export type Provider = 'resend' | 'loops';

export interface CampaignSummary {
  provider: Provider;
  id: string;
  subject: string;
  sentAt: string; // ISO
  totalSent: number;
  delivered: number;
  opened: number;
  clicked: number;
  bounced: number;
  unsubscribed: number;
}

export interface CampaignsOverview {
  totalSent30d: number;
  deliveredRate: number;
  openRate: number;
  clickRate: number;
  bounceRate: number;
}

const RESEND_API = 'https://api.resend.com';
const LOOPS_API = 'https://app.loops.so/api/v1';

// ── Auth ─────────────────────────────────────────────────────────────────────

async function getToolkitKey(
  spaceId: string,
  toolkit: Provider,
  envName: string,
): Promise<string> {
  const { data } = await supabase
    .from('IntegrationConnection')
    .select('accessToken')
    .eq('spaceId', spaceId)
    .eq('toolkit', toolkit)
    .eq('status', 'active')
    .maybeSingle();

  const token = (data as { accessToken?: string } | null)?.accessToken;
  if (token) return token;

  const env = process.env[envName];
  if (env) return env;

  throw new Error(
    `${toolkit}: no API key found for space ${spaceId}. ` +
      `Connect ${toolkit} in Settings → Integrations, or set ${envName}.`,
  );
}

// ── Shared shapes ────────────────────────────────────────────────────────────

interface ResendEmail {
  id: string;
  to?: string[] | string;
  subject?: string;
  from?: string;
  last_event?: string;
  created_at?: string;
}

interface ResendListResponse {
  data?: ResendEmail[];
}

// ── Resend ───────────────────────────────────────────────────────────────────

/**
 * Group Resend's per-recipient emails into "campaigns" by (subject, day).
 * Resend doesn't have a campaign concept on the free tier — closest proxy
 * is "all the messages with the same subject sent on the same day."
 */
export async function loadResendCampaigns(
  spaceId: string,
  opts: { days?: number } = {},
): Promise<CampaignSummary[]> {
  const days = opts.days ?? 30;
  try {
    const key = await getToolkitKey(spaceId, 'resend', 'RESEND_API_KEY');

    const since = new Date(Date.now() - days * 86_400_000);
    const url = new URL(`${RESEND_API}/emails`);
    url.searchParams.set('date_from', since.toISOString().slice(0, 10));

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!res.ok) return [];

    const body = (await res.json()) as ResendListResponse;
    const emails = Array.isArray(body?.data) ? body.data : [];
    return rollupResendEmails(emails);
  } catch {
    return [];
  }
}

/**
 * Exported for tests. Groups raw Resend email rows into campaign summaries.
 */
export function rollupResendEmails(emails: ResendEmail[]): CampaignSummary[] {
  const groups = new Map<
    string,
    {
      id: string;
      subject: string;
      sentAt: string;
      totalSent: number;
      delivered: number;
      opened: number;
      clicked: number;
      bounced: number;
      unsubscribed: number;
    }
  >();

  for (const e of emails) {
    const subject = (e.subject ?? '(no subject)').trim() || '(no subject)';
    const createdAt = e.created_at ?? new Date().toISOString();
    const day = createdAt.slice(0, 10);
    const key = `${subject}::${day}`;

    const g = groups.get(key) ?? {
      id: e.id, // first email's id is the campaign id proxy
      subject,
      sentAt: createdAt,
      totalSent: 0,
      delivered: 0,
      opened: 0,
      clicked: 0,
      bounced: 0,
      unsubscribed: 0,
    };

    g.totalSent += 1;

    // Keep the earliest sentAt for the group so the table shows when the
    // campaign actually started.
    if (createdAt < g.sentAt) g.sentAt = createdAt;

    // last_event is a single string; downstream events imply upstream
    // ones (clicked => opened => delivered). Mirror that here.
    switch (e.last_event) {
      case 'clicked':
        g.clicked += 1;
        g.opened += 1;
        g.delivered += 1;
        break;
      case 'opened':
        g.opened += 1;
        g.delivered += 1;
        break;
      case 'delivered':
        g.delivered += 1;
        break;
      case 'bounced':
        g.bounced += 1;
        break;
      case 'complained':
        g.unsubscribed += 1;
        break;
      // 'sent' / 'queued' / unknown — counted in totalSent only
    }

    groups.set(key, g);
  }

  return [...groups.values()].map((g) => ({ provider: 'resend' as const, ...g }));
}

// ── Loops ────────────────────────────────────────────────────────────────────

interface LoopsTransactional {
  id?: string;
  transactionalId?: string;
  name?: string;
  subject?: string;
}

interface LoopsEvent {
  transactionalId?: string;
  templateId?: string;
  eventName?: string;
  createdAt?: string;
  timestamp?: string | number;
}

/**
 * Loops: list transactional templates, then count sends per template.
 *
 * We use:
 *   GET /transactional       — list templates (id, name, subject)
 *   GET /events              — recent event stream, filtered to
 *                              `loops_email_sent`, to count per template
 *
 * Loops does NOT expose per-template open / click / bounce aggregates in
 * the public REST API. Those fields stay at 0 here; the dashboard treats
 * 0 as "not reported" rather than "zero engagement." We will NOT fake
 * what we can't measure.
 */
export async function loadLoopsCampaigns(
  spaceId: string,
  opts: { days?: number } = {},
): Promise<CampaignSummary[]> {
  const days = opts.days ?? 30;
  try {
    const key = await getToolkitKey(spaceId, 'loops', 'LOOPS_API_KEY');
    const since = Date.now() - days * 86_400_000;

    const headers = {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    };

    // 1. List transactional templates.
    const tRes = await fetch(`${LOOPS_API}/transactional`, { headers });
    if (!tRes.ok) return [];
    const tBody = (await tRes.json()) as
      | LoopsTransactional[]
      | { data?: LoopsTransactional[] };
    const templates = Array.isArray(tBody)
      ? tBody
      : Array.isArray(tBody?.data)
      ? tBody.data
      : [];

    if (templates.length === 0) return [];

    // 2. Pull recent sent-events. Loops returns the stream in one call;
    // if the endpoint isn't available, bail with totalSent unknown (0).
    let events: LoopsEvent[] = [];
    try {
      const eRes = await fetch(
        `${LOOPS_API}/events?eventName=loops_email_sent`,
        { headers },
      );
      if (eRes.ok) {
        const eBody = (await eRes.json()) as LoopsEvent[] | { data?: LoopsEvent[] };
        events = Array.isArray(eBody)
          ? eBody
          : Array.isArray(eBody?.data)
          ? eBody.data
          : [];
      }
    } catch {
      events = [];
    }

    return rollupLoopsTemplates(templates, events, since);
  } catch {
    return [];
  }
}

/**
 * Exported for tests. Counts sent-events per template, returns one row
 * per template that had at least one send (or zero sends, included so
 * users can see configured templates).
 */
export function rollupLoopsTemplates(
  templates: LoopsTransactional[],
  events: LoopsEvent[],
  sinceMs: number,
): CampaignSummary[] {
  const sentByTemplate = new Map<string, { count: number; latest: number }>();
  for (const e of events) {
    const tid = e.transactionalId ?? e.templateId;
    if (!tid) continue;
    const tsRaw = e.timestamp ?? e.createdAt;
    const ts =
      typeof tsRaw === 'number'
        ? tsRaw
        : tsRaw
        ? Date.parse(tsRaw)
        : Date.now();
    if (Number.isFinite(ts) && ts < sinceMs) continue;
    const prev = sentByTemplate.get(tid) ?? { count: 0, latest: 0 };
    prev.count += 1;
    if (ts > prev.latest) prev.latest = ts;
    sentByTemplate.set(tid, prev);
  }

  return templates
    .map((t) => {
      const id = t.id ?? t.transactionalId ?? '';
      const agg = sentByTemplate.get(id) ?? { count: 0, latest: Date.now() };
      const subject = t.subject ?? t.name ?? id ?? '(unnamed template)';
      return {
        provider: 'loops' as const,
        id,
        subject,
        sentAt: new Date(agg.latest).toISOString(),
        totalSent: agg.count,
        // Loops public API doesn't expose these per-template — leave 0.
        delivered: 0,
        opened: 0,
        clicked: 0,
        bounced: 0,
        unsubscribed: 0,
      };
    })
    .filter((c) => c.id);
}

// ── Overview + merged feed ───────────────────────────────────────────────────

export function computeOverview(rows: CampaignSummary[]): CampaignsOverview {
  let sent = 0;
  let delivered = 0;
  let opened = 0;
  let clicked = 0;
  let bounced = 0;
  for (const r of rows) {
    sent += r.totalSent;
    delivered += r.delivered;
    opened += r.opened;
    clicked += r.clicked;
    bounced += r.bounced;
  }
  const safe = (n: number, d: number) => (d > 0 ? n / d : 0);
  return {
    totalSent30d: sent,
    deliveredRate: safe(delivered, sent),
    openRate: safe(opened, sent),
    clickRate: safe(clicked, sent),
    bounceRate: safe(bounced, sent),
  };
}

export async function loadCampaignsOverview(
  spaceId: string,
  days = 30,
): Promise<CampaignsOverview> {
  const results = await Promise.allSettled([
    loadResendCampaigns(spaceId, { days }),
    loadLoopsCampaigns(spaceId, { days }),
  ]);
  const rows = results.flatMap((r) =>
    r.status === 'fulfilled' ? r.value : [],
  );
  return computeOverview(rows);
}

export async function loadRecentCampaigns(
  spaceId: string,
  days = 30,
): Promise<CampaignSummary[]> {
  const results = await Promise.allSettled([
    loadResendCampaigns(spaceId, { days }),
    loadLoopsCampaigns(spaceId, { days }),
  ]);
  const rows = results.flatMap((r) =>
    r.status === 'fulfilled' ? r.value : [],
  );
  rows.sort((a, b) => (a.sentAt < b.sentAt ? 1 : a.sentAt > b.sentAt ? -1 : 0));
  return rows;
}
