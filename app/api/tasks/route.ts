/**
 * GET  /api/tasks   — list tasks for the caller's workspace.
 * POST /api/tasks   — create a task as the founder.
 *
 * Auth: owner-only (getSpaceForUser). Mirrors the documents-route pattern.
 *
 * GET shape:
 *   { tasks: Task[] }
 *
 * GET filters (optional, AND-ed):
 *   ?status=open|in_progress|done|cancelled
 *   ?assignee=founder | unassigned | <dept-slug>
 *
 * Default order: status bucket first (open + in_progress before done +
 * cancelled), then priority (high → low), then dueAt asc, then createdAt
 * desc. Postgres can't express a custom-bucket sort cleanly with PostgREST,
 * so we sort the bucket dimension in code after fetching.
 *
 * POST body:
 *   { title, description?, priority?, assigneeKind?, assigneeDept?, dueAt? }
 * Returns the inserted Task on 200.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { requireAuth } from '@/lib/api-auth';
import { getSpaceForUser } from '@/lib/space';
import {
  isDepartmentSlug,
  isTaskPriority,
  isTaskStatus,
  type Task,
  type TaskPriority,
  type TaskStatus,
} from '@/lib/tasks/catalog';

const TITLE_MAX = 200;
const DESC_MAX = 2000;

const STATUS_BUCKET: Record<TaskStatus, number> = {
  open: 0,
  in_progress: 0,
  done: 1,
  cancelled: 2,
};

const PRIORITY_RANK: Record<TaskPriority, number> = {
  high: 0,
  normal: 1,
  low: 2,
};

function sortTasks(rows: Task[]): Task[] {
  return [...rows].sort((a, b) => {
    const bucketDelta = STATUS_BUCKET[a.status] - STATUS_BUCKET[b.status];
    if (bucketDelta !== 0) return bucketDelta;

    const priDelta = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    if (priDelta !== 0) return priDelta;

    // dueAt asc — null sorts to the end
    if (a.dueAt && b.dueAt) {
      const da = new Date(a.dueAt).getTime();
      const db = new Date(b.dueAt).getTime();
      if (da !== db) return da - db;
    } else if (a.dueAt && !b.dueAt) {
      return -1;
    } else if (!a.dueAt && b.dueAt) {
      return 1;
    }

    // createdAt desc
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}

export async function GET(req: NextRequest) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  const space = await getSpaceForUser(userId);
  if (!space) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const statusParam = req.nextUrl.searchParams.get('status');
  const assigneeParam = req.nextUrl.searchParams.get('assignee');

  let query = supabase
    .from('Task')
    .select(
      'id, spaceId, title, description, status, priority, assigneeKind, assigneeDept, createdBy, createdByDept, dueAt, completedAt, createdAt, updatedAt',
    )
    .eq('spaceId', space.id);

  if (statusParam) {
    if (!isTaskStatus(statusParam)) {
      return NextResponse.json({ error: 'Invalid status filter' }, { status: 400 });
    }
    query = query.eq('status', statusParam);
  }

  if (assigneeParam) {
    if (assigneeParam === 'founder' || assigneeParam === 'unassigned') {
      query = query.eq('assigneeKind', assigneeParam);
    } else if (isDepartmentSlug(assigneeParam)) {
      query = query.eq('assigneeKind', 'agent').eq('assigneeDept', assigneeParam);
    } else {
      return NextResponse.json({ error: 'Invalid assignee filter' }, { status: 400 });
    }
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: 'Lookup failed' }, { status: 500 });
  }

  const tasks = sortTasks((data ?? []) as Task[]);
  return NextResponse.json({ tasks });
}

interface PostBody {
  title?: unknown;
  description?: unknown;
  priority?: unknown;
  assigneeKind?: unknown;
  assigneeDept?: unknown;
  dueAt?: unknown;
}

export async function POST(req: NextRequest) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  const space = await getSpaceForUser(userId);
  if (!space) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (typeof body.title !== 'string') {
    return NextResponse.json({ error: 'title (string) is required' }, { status: 400 });
  }
  const title = body.title.trim();
  if (title.length === 0) {
    return NextResponse.json({ error: 'title cannot be empty' }, { status: 400 });
  }
  if (title.length > TITLE_MAX) {
    return NextResponse.json({ error: `title must be <= ${TITLE_MAX} chars` }, { status: 400 });
  }

  let description = '';
  if (body.description !== undefined) {
    if (typeof body.description !== 'string') {
      return NextResponse.json({ error: 'description must be a string' }, { status: 400 });
    }
    description = body.description;
    if (description.length > DESC_MAX) {
      return NextResponse.json(
        { error: `description must be <= ${DESC_MAX} chars` },
        { status: 400 },
      );
    }
  }

  let priority: TaskPriority = 'normal';
  if (body.priority !== undefined) {
    if (typeof body.priority !== 'string' || !isTaskPriority(body.priority)) {
      return NextResponse.json({ error: 'Invalid priority' }, { status: 400 });
    }
    priority = body.priority;
  }

  let assigneeKind: 'founder' | 'agent' | 'unassigned' = 'founder';
  if (body.assigneeKind !== undefined) {
    if (
      body.assigneeKind !== 'founder' &&
      body.assigneeKind !== 'agent' &&
      body.assigneeKind !== 'unassigned'
    ) {
      return NextResponse.json({ error: 'Invalid assigneeKind' }, { status: 400 });
    }
    assigneeKind = body.assigneeKind;
  }

  let assigneeDept: string | null = null;
  if (assigneeKind === 'agent') {
    if (typeof body.assigneeDept !== 'string' || !isDepartmentSlug(body.assigneeDept)) {
      return NextResponse.json(
        { error: 'assigneeDept must be a valid department slug when assigneeKind is "agent"' },
        { status: 400 },
      );
    }
    assigneeDept = body.assigneeDept;
  }

  let dueAt: string | null = null;
  if (body.dueAt !== undefined && body.dueAt !== null) {
    if (typeof body.dueAt !== 'string') {
      return NextResponse.json({ error: 'dueAt must be an ISO string' }, { status: 400 });
    }
    const d = new Date(body.dueAt);
    if (Number.isNaN(d.getTime())) {
      return NextResponse.json({ error: 'dueAt must be a valid ISO date' }, { status: 400 });
    }
    dueAt = d.toISOString();
  }

  const { data: inserted, error: insertErr } = await supabase
    .from('Task')
    .insert({
      spaceId: space.id,
      title,
      description,
      priority,
      assigneeKind,
      assigneeDept,
      createdBy: 'founder',
      createdByDept: null,
      dueAt,
    })
    .select(
      'id, spaceId, title, description, status, priority, assigneeKind, assigneeDept, createdBy, createdByDept, dueAt, completedAt, createdAt, updatedAt',
    )
    .single();

  if (insertErr || !inserted) {
    return NextResponse.json({ error: 'Insert failed' }, { status: 500 });
  }

  return NextResponse.json(inserted as Task);
}
