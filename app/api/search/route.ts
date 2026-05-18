/**
 * GET /api/search — global content search for the command palette.
 *
 * Founder data only: Documents, Tasks, StageGates, AgentDrafts. ILIKE substring
 * over title/content columns, scoped to the caller's workspace. Each kind runs
 * in parallel via Promise.allSettled — one failure surfaces an empty array for
 * that kind, never blocks the others. Capped at `limit` per kind, 50 total.
 * No tsvector, no third-party index — low-volume founder data, ILIKE is fine.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { requireAuth } from '@/lib/api-auth';
import { getSpaceForUser } from '@/lib/space';

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 30;
const TOTAL_CAP = 50;
const MIN_QUERY_LEN = 2;

export interface DocumentHit {
  kind: 'document';
  id: string;
  slug: string;
  title: string;
  snippet: string;
  href: string;
}

export interface TaskHit {
  kind: 'task';
  id: string;
  title: string;
  snippet: string;
  status: string;
  priority: string;
  href: string;
}

export interface GateHit {
  kind: 'gate';
  id: string;
  title: string;
  stage: string;
  isComplete: boolean;
  href: string;
}

export interface DraftHit {
  kind: 'draft';
  id: string;
  intent: string;
  title: string;
  snippet: string;
  status: string;
  href: string;
}

export interface SearchResponse {
  documents: DocumentHit[];
  tasks: TaskHit[];
  gates: GateHit[];
  drafts: DraftHit[];
}

const EMPTY: SearchResponse = { documents: [], tasks: [], gates: [], drafts: [] };

function clampLimit(raw: string | null): number {
  if (!raw) return DEFAULT_LIMIT;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

/** Escape ILIKE special chars + strip PostgREST syntax chars from `.or()`. */
function buildTerm(q: string): string | null {
  const escaped = q.slice(0, 100).replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
  const sanitized = escaped.replace(/[,()\.:;'"]/g, '');
  if (!sanitized.trim()) return null;
  return `%${sanitized}%`;
}

/** First slice of `content` that contains the term, capped at 200 chars. */
function snippetFromContent(content: string | null | undefined, q: string): string {
  if (!content) return '';
  const lower = content.toLowerCase();
  const idx = lower.indexOf(q.toLowerCase());
  if (idx < 0) return content.slice(0, 200);
  const start = Math.max(0, idx - 40);
  return content.slice(start, start + 200);
}

export async function GET(req: NextRequest) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  const q = (req.nextUrl.searchParams.get('q') ?? '').trim();
  const limit = clampLimit(req.nextUrl.searchParams.get('limit'));

  if (q.length < MIN_QUERY_LEN) return NextResponse.json(EMPTY);

  const term = buildTerm(q);
  if (!term) return NextResponse.json(EMPTY);

  const space = await getSpaceForUser(userId);
  if (!space) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  // Each kind runs independently; one failure returns [] for that kind only.
  const [docsRes, tasksRes, gatesRes, draftsRes] = await Promise.allSettled([
    supabase
      .from('Document')
      .select('id, slug, title, content')
      .eq('spaceId', space.id)
      .or(`title.ilike.${term},content.ilike.${term}`)
      .limit(limit),
    supabase
      .from('Task')
      .select('id, title, description, status, priority')
      .eq('spaceId', space.id)
      .or(`title.ilike.${term},description.ilike.${term}`)
      .limit(limit),
    supabase
      .from('StageGate')
      .select('id, title, stage, isComplete')
      .eq('spaceId', space.id)
      .ilike('title', term)
      .limit(limit),
    supabase
      .from('AgentDraft')
      .select('id, subject, content, status')
      .eq('spaceId', space.id)
      .or(`subject.ilike.${term},content.ilike.${term}`)
      .limit(limit),
  ]);

  const documents: DocumentHit[] = unwrap<{ id: string; slug: string; title: string; content: string }>(docsRes).map(
    (r) => ({
      kind: 'document',
      id: r.id,
      slug: r.slug,
      title: r.title,
      snippet: snippetFromContent(r.content, q),
      href: `/documents/${r.slug}`,
    }),
  );

  const tasks: TaskHit[] = unwrap<{ id: string; title: string; description: string; status: string; priority: string }>(
    tasksRes,
  ).map((r) => ({
    kind: 'task',
    id: r.id,
    title: r.title,
    snippet: snippetFromContent(r.description, q),
    status: r.status,
    priority: r.priority,
    href: `/tasks/${r.id}`,
  }));

  const gates: GateHit[] = unwrap<{ id: string; title: string; stage: string; isComplete: boolean }>(gatesRes).map(
    (r) => ({
      kind: 'gate',
      id: r.id,
      title: r.title,
      stage: r.stage,
      isComplete: r.isComplete,
      href: `/stages/gates/${r.id}`,
    }),
  );

  const drafts: DraftHit[] = unwrap<{ id: string; subject: string | null; content: string; status: string }>(
    draftsRes,
  ).map((r) => ({
    kind: 'draft',
    id: r.id,
    // AgentDraft has no `intent` or `title` column — surface subject (or a
    // status-based label) as the headline and content as the snippet body.
    intent: r.status,
    title: r.subject ?? r.content.slice(0, 60),
    snippet: snippetFromContent(r.content, q),
    status: r.status,
    href: `/inbox`,
  }));

  // Total cap: trim each bucket proportionally if combined > TOTAL_CAP.
  const trimmed = capTotal({ documents, tasks, gates, drafts });

  return NextResponse.json(trimmed satisfies SearchResponse);
}

/** Pull rows out of a settled Supabase promise, returning [] on any failure. */
function unwrap<T>(
  result: PromiseSettledResult<{ data: unknown; error: unknown } | unknown>,
): T[] {
  if (result.status !== 'fulfilled') return [];
  const value = result.value as { data?: unknown; error?: unknown };
  if (!value || value.error) return [];
  const data = value.data;
  return Array.isArray(data) ? (data as T[]) : [];
}

function capTotal(r: SearchResponse): SearchResponse {
  const total = r.documents.length + r.tasks.length + r.gates.length + r.drafts.length;
  if (total <= TOTAL_CAP) return r;
  // Simple deterministic trim: keep priority order documents > tasks > gates > drafts
  // (founder reads docs/tasks most). Drop from the tail.
  let budget = TOTAL_CAP;
  const documents = r.documents.slice(0, budget);
  budget -= documents.length;
  const tasks = r.tasks.slice(0, Math.max(0, budget));
  budget -= tasks.length;
  const gates = r.gates.slice(0, Math.max(0, budget));
  budget -= gates.length;
  const drafts = r.drafts.slice(0, Math.max(0, budget));
  return { documents, tasks, gates, drafts };
}
