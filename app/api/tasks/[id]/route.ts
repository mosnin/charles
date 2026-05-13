/**
 * PATCH  /api/tasks/[id] — update a task.
 * DELETE /api/tasks/[id] — hard delete.
 *
 * Auth: caller must own the space the task belongs to.
 *
 * PATCH body: any subset of
 *   { title, description, status, priority, assigneeKind, assigneeDept, dueAt }
 *
 * Side effect: when status flips to 'done' we stamp completedAt; when it
 * flips away from 'done' we clear it. Everything else is a literal update.
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
} from '@/lib/tasks/catalog';

const TITLE_MAX = 200;
const DESC_MAX = 2000;

interface PatchBody {
  title?: unknown;
  description?: unknown;
  status?: unknown;
  priority?: unknown;
  assigneeKind?: unknown;
  assigneeDept?: unknown;
  dueAt?: unknown;
}

async function loadOwnedTask(
  taskId: string,
  userId: string,
): Promise<
  | { ok: true; task: { id: string; spaceId: string; status: string } }
  | { ok: false; res: NextResponse }
> {
  const { data: task, error } = await supabase
    .from('Task')
    .select('id, spaceId, status')
    .eq('id', taskId)
    .maybeSingle();
  if (error) {
    return { ok: false, res: NextResponse.json({ error: 'Lookup failed' }, { status: 500 }) };
  }
  if (!task) {
    return { ok: false, res: NextResponse.json({ error: 'Task not found' }, { status: 404 }) };
  }

  const space = await getSpaceForUser(userId);
  if (!space || space.id !== (task as { spaceId: string }).spaceId) {
    return { ok: false, res: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }
  return { ok: true, task: task as { id: string; spaceId: string; status: string } };
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: 'id required' }, { status: 400 });
  }

  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const owned = await loadOwnedTask(id, userId);
  if (!owned.ok) return owned.res;

  const update: Record<string, unknown> = { updatedAt: new Date().toISOString() };

  if (body.title !== undefined) {
    if (typeof body.title !== 'string') {
      return NextResponse.json({ error: 'title must be a string' }, { status: 400 });
    }
    const t = body.title.trim();
    if (t.length === 0) {
      return NextResponse.json({ error: 'title cannot be empty' }, { status: 400 });
    }
    if (t.length > TITLE_MAX) {
      return NextResponse.json({ error: `title must be <= ${TITLE_MAX} chars` }, { status: 400 });
    }
    update.title = t;
  }

  if (body.description !== undefined) {
    if (typeof body.description !== 'string') {
      return NextResponse.json({ error: 'description must be a string' }, { status: 400 });
    }
    if (body.description.length > DESC_MAX) {
      return NextResponse.json(
        { error: `description must be <= ${DESC_MAX} chars` },
        { status: 400 },
      );
    }
    update.description = body.description;
  }

  let nextStatus: string | undefined;
  if (body.status !== undefined) {
    if (typeof body.status !== 'string' || !isTaskStatus(body.status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
    }
    nextStatus = body.status;
    update.status = nextStatus;
    if (nextStatus === 'done' && owned.task.status !== 'done') {
      update.completedAt = new Date().toISOString();
    } else if (nextStatus !== 'done' && owned.task.status === 'done') {
      update.completedAt = null;
    }
  }

  if (body.priority !== undefined) {
    if (typeof body.priority !== 'string' || !isTaskPriority(body.priority)) {
      return NextResponse.json({ error: 'Invalid priority' }, { status: 400 });
    }
    update.priority = body.priority;
  }

  let nextAssigneeKind: 'founder' | 'agent' | 'unassigned' | undefined;
  if (body.assigneeKind !== undefined) {
    if (
      body.assigneeKind !== 'founder' &&
      body.assigneeKind !== 'agent' &&
      body.assigneeKind !== 'unassigned'
    ) {
      return NextResponse.json({ error: 'Invalid assigneeKind' }, { status: 400 });
    }
    nextAssigneeKind = body.assigneeKind;
    update.assigneeKind = nextAssigneeKind;
    // founder / unassigned wipe assigneeDept unless the body also supplies one
    if (nextAssigneeKind !== 'agent' && body.assigneeDept === undefined) {
      update.assigneeDept = null;
    }
  }

  if (body.assigneeDept !== undefined) {
    if (body.assigneeDept === null) {
      update.assigneeDept = null;
    } else if (typeof body.assigneeDept === 'string' && isDepartmentSlug(body.assigneeDept)) {
      update.assigneeDept = body.assigneeDept;
    } else {
      return NextResponse.json({ error: 'Invalid assigneeDept' }, { status: 400 });
    }
  }

  // If after merging this update assigneeKind is 'agent', we must have a dept.
  if (nextAssigneeKind === 'agent' && update.assigneeDept == null) {
    return NextResponse.json(
      { error: 'assigneeDept required when assigneeKind is "agent"' },
      { status: 400 },
    );
  }

  if (body.dueAt !== undefined) {
    if (body.dueAt === null) {
      update.dueAt = null;
    } else if (typeof body.dueAt === 'string') {
      const d = new Date(body.dueAt);
      if (Number.isNaN(d.getTime())) {
        return NextResponse.json({ error: 'dueAt must be a valid ISO date' }, { status: 400 });
      }
      update.dueAt = d.toISOString();
    } else {
      return NextResponse.json({ error: 'dueAt must be a string or null' }, { status: 400 });
    }
  }

  const { data: updated, error: updateErr } = await supabase
    .from('Task')
    .update(update)
    .eq('id', id)
    .select(
      'id, spaceId, title, description, status, priority, assigneeKind, assigneeDept, createdBy, createdByDept, dueAt, completedAt, createdAt, updatedAt',
    )
    .single();

  if (updateErr || !updated) {
    return NextResponse.json({ error: 'Update failed' }, { status: 500 });
  }

  return NextResponse.json(updated as Task);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: 'id required' }, { status: 400 });
  }

  const owned = await loadOwnedTask(id, userId);
  if (!owned.ok) return owned.res;

  const { error: delErr } = await supabase.from('Task').delete().eq('id', id);
  if (delErr) {
    return NextResponse.json({ error: 'Delete failed' }, { status: 500 });
  }

  return new NextResponse(null, { status: 204 });
}
