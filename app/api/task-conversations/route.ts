/**
 * GET  /api/task-conversations?taskId=...|?gateId=...
 *   Returns the existing TaskConversation (with messages, oldest first) for
 *   the given task or gate, or `{ conversation: null }` if none exists.
 *
 * POST /api/task-conversations
 *   Body: { taskId?: string; gateId?: string; subject: string }
 *   Idempotent: if a conversation already exists for the task/gate it is
 *   returned as-is. Otherwise a fresh row is inserted.
 *
 * Auth: owner-only via getSpaceForUser. The targeted Task or StageGate must
 * live inside the caller's space.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { requireAuth } from '@/lib/api-auth';
import { getSpaceForUser } from '@/lib/space';

const SUBJECT_MAX = 200;

interface TaskMessageRow {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

interface ConversationRow {
  id: string;
  spaceId: string;
  taskId: string | null;
  gateId: string | null;
  subject: string;
  createdAt: string;
  updatedAt: string;
}

async function loadOwnedTarget(opts: {
  spaceId: string;
  taskId?: string | null;
  gateId?: string | null;
}): Promise<{ ok: true } | { ok: false; res: NextResponse }> {
  if (opts.taskId) {
    const { data, error } = await supabase
      .from('Task')
      .select('id, spaceId')
      .eq('id', opts.taskId)
      .maybeSingle();
    if (error) {
      return { ok: false, res: NextResponse.json({ error: 'Lookup failed' }, { status: 500 }) };
    }
    if (!data) {
      return { ok: false, res: NextResponse.json({ error: 'Task not found' }, { status: 404 }) };
    }
    if ((data as { spaceId: string }).spaceId !== opts.spaceId) {
      return { ok: false, res: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
    }
    return { ok: true };
  }
  if (opts.gateId) {
    const { data, error } = await supabase
      .from('StageGate')
      .select('id, spaceId')
      .eq('id', opts.gateId)
      .maybeSingle();
    if (error) {
      return { ok: false, res: NextResponse.json({ error: 'Lookup failed' }, { status: 500 }) };
    }
    if (!data) {
      return { ok: false, res: NextResponse.json({ error: 'Gate not found' }, { status: 404 }) };
    }
    if ((data as { spaceId: string }).spaceId !== opts.spaceId) {
      return { ok: false, res: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
    }
    return { ok: true };
  }
  return { ok: false, res: NextResponse.json({ error: 'taskId or gateId required' }, { status: 400 }) };
}

async function fetchMessages(conversationId: string): Promise<TaskMessageRow[]> {
  const { data, error } = await supabase
    .from('TaskMessage')
    .select('id, conversationId, role, content, metadata, createdAt')
    .eq('conversationId', conversationId)
    .order('createdAt', { ascending: true });
  if (error || !data) return [];
  return data as TaskMessageRow[];
}

export async function GET(req: NextRequest) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  const space = await getSpaceForUser(userId);
  if (!space) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const taskId = req.nextUrl.searchParams.get('taskId');
  const gateId = req.nextUrl.searchParams.get('gateId');

  if ((taskId && gateId) || (!taskId && !gateId)) {
    return NextResponse.json(
      { error: 'Exactly one of taskId or gateId is required' },
      { status: 400 },
    );
  }

  const guard = await loadOwnedTarget({ spaceId: space.id, taskId, gateId });
  if (!guard.ok) return guard.res;

  let query = supabase
    .from('TaskConversation')
    .select('id, spaceId, taskId, gateId, subject, createdAt, updatedAt')
    .eq('spaceId', space.id);
  query = taskId ? query.eq('taskId', taskId) : query.eq('gateId', gateId as string);

  const { data: convRow, error: convErr } = await query.maybeSingle();
  if (convErr) {
    return NextResponse.json({ error: 'Lookup failed' }, { status: 500 });
  }
  if (!convRow) {
    return NextResponse.json({ conversation: null, messages: [] });
  }

  const messages = await fetchMessages((convRow as ConversationRow).id);
  return NextResponse.json({ conversation: convRow, messages });
}

interface PostBody {
  taskId?: unknown;
  gateId?: unknown;
  subject?: unknown;
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

  const taskId = typeof body.taskId === 'string' && body.taskId.length > 0 ? body.taskId : null;
  const gateId = typeof body.gateId === 'string' && body.gateId.length > 0 ? body.gateId : null;
  if ((taskId && gateId) || (!taskId && !gateId)) {
    return NextResponse.json(
      { error: 'Exactly one of taskId or gateId is required' },
      { status: 400 },
    );
  }

  if (typeof body.subject !== 'string') {
    return NextResponse.json({ error: 'subject (string) is required' }, { status: 400 });
  }
  const subject = body.subject.trim();
  if (subject.length === 0) {
    return NextResponse.json({ error: 'subject cannot be empty' }, { status: 400 });
  }
  if (subject.length > SUBJECT_MAX) {
    return NextResponse.json({ error: `subject must be <= ${SUBJECT_MAX} chars` }, { status: 400 });
  }

  const guard = await loadOwnedTarget({ spaceId: space.id, taskId, gateId });
  if (!guard.ok) return guard.res;

  // Idempotency: if a conversation already exists, return it.
  let existingQuery = supabase
    .from('TaskConversation')
    .select('id, spaceId, taskId, gateId, subject, createdAt, updatedAt')
    .eq('spaceId', space.id);
  existingQuery = taskId
    ? existingQuery.eq('taskId', taskId)
    : existingQuery.eq('gateId', gateId as string);

  const { data: existing, error: existingErr } = await existingQuery.maybeSingle();
  if (existingErr) {
    return NextResponse.json({ error: 'Lookup failed' }, { status: 500 });
  }
  if (existing) {
    return NextResponse.json({ conversation: existing });
  }

  const { data: inserted, error: insertErr } = await supabase
    .from('TaskConversation')
    .insert({
      spaceId: space.id,
      taskId,
      gateId,
      subject,
    })
    .select('id, spaceId, taskId, gateId, subject, createdAt, updatedAt')
    .single();

  if (insertErr || !inserted) {
    return NextResponse.json({ error: 'Insert failed' }, { status: 500 });
  }

  return NextResponse.json({ conversation: inserted });
}
