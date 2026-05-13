/**
 * POST /api/task-conversations/[id]/messages
 *
 * Body: { content: string; metadata?: object }
 *
 * Inserts the user message, generates a canned assistant reply via
 * cannedAssistantReply(), inserts that, bumps the conversation's
 * updatedAt, and returns both messages.
 *
 * Real agent wiring lives in Phase 7. This route is the placeholder
 * that lets the UX feel alive — keyword-classified "delegating to X"
 * replies, nothing more.
 *
 * Auth: caller must own the space the conversation belongs to.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { requireAuth } from '@/lib/api-auth';
import { getSpaceForUser } from '@/lib/space';
import { cannedAssistantReply } from '@/lib/tasks/conversation-helpers';

const CONTENT_MAX = 4000;

interface PostBody {
  content?: unknown;
  metadata?: unknown;
}

export async function POST(
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

  if (typeof body.content !== 'string') {
    return NextResponse.json({ error: 'content (string) is required' }, { status: 400 });
  }
  const content = body.content.trim();
  if (content.length === 0) {
    return NextResponse.json({ error: 'content cannot be empty' }, { status: 400 });
  }
  if (content.length > CONTENT_MAX) {
    return NextResponse.json({ error: `content must be <= ${CONTENT_MAX} chars` }, { status: 400 });
  }

  let metadata: Record<string, unknown> | null = null;
  if (body.metadata !== undefined && body.metadata !== null) {
    if (typeof body.metadata !== 'object' || Array.isArray(body.metadata)) {
      return NextResponse.json({ error: 'metadata must be an object' }, { status: 400 });
    }
    metadata = body.metadata as Record<string, unknown>;
  }

  // Ownership: load the conversation and check it lives in the caller's space.
  const { data: conv, error: convErr } = await supabase
    .from('TaskConversation')
    .select('id, spaceId')
    .eq('id', id)
    .maybeSingle();
  if (convErr) {
    return NextResponse.json({ error: 'Lookup failed' }, { status: 500 });
  }
  if (!conv) {
    return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
  }
  if ((conv as { spaceId: string }).spaceId !== space.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Insert the user message.
  const { data: userMsg, error: userErr } = await supabase
    .from('TaskMessage')
    .insert({
      conversationId: id,
      role: 'user',
      content,
      metadata,
    })
    .select('id, conversationId, role, content, metadata, createdAt')
    .single();
  if (userErr || !userMsg) {
    return NextResponse.json({ error: 'Insert failed' }, { status: 500 });
  }

  // Canned assistant reply.
  const canned = cannedAssistantReply(content);
  const { data: assistantMsg, error: asErr } = await supabase
    .from('TaskMessage')
    .insert({
      conversationId: id,
      role: 'assistant',
      content: canned.content,
      metadata: canned.metadata,
    })
    .select('id, conversationId, role, content, metadata, createdAt')
    .single();
  if (asErr || !assistantMsg) {
    return NextResponse.json({ error: 'Assistant insert failed' }, { status: 500 });
  }

  // Bump updatedAt — best effort, don't fail the request if it errors.
  await supabase
    .from('TaskConversation')
    .update({ updatedAt: new Date().toISOString() })
    .eq('id', id);

  return NextResponse.json({ user: userMsg, assistant: assistantMsg });
}
