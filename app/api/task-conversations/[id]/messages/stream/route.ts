/**
 * POST /api/task-conversations/[id]/messages/stream
 *
 * Server-Sent Events variant of the messages POST. Inserts the user
 * message, streams the assistant reply chunk-by-chunk over SSE, then
 * persists the full assistant row after the stream completes. Falls
 * back to the canned reply when OpenAI is unavailable.
 */

import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { supabase } from '@/lib/supabase';
import { requireAuth } from '@/lib/api-auth';
import { getSpaceForUser } from '@/lib/space';
import {
  cannedAssistantReply,
  classifyDepartment,
} from '@/lib/tasks/conversation-helpers';
import { loadMemoryLayers } from '@/lib/agent-memory/layers';
import {
  buildPersonalizedSystemPrompt,
  type Mission,
  type MissionContext,
} from '@/lib/ai-tools/system-prompt';
import { emitCostEvent } from '@/lib/observability/cost-events';
import { logger } from '@/lib/logger';
import { DEPARTMENT_LABELS } from '@/lib/tasks/catalog';

const CONTENT_MAX = 4000;
const DEFAULT_MODEL = 'gpt-5-mini';
const HISTORY_LIMIT = 20;
const MEMORY_TOP_K = 8;

interface PostBody {
  content?: unknown;
  metadata?: unknown;
}

interface ConvMessageRow {
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: string;
}

function sseEncode(obj: unknown): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(obj)}\n\n`);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  const { id } = await params;
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const space = await getSpaceForUser(userId);
  if (!space) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

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

  // Ownership check.
  const { data: conv, error: convErr } = await supabase
    .from('TaskConversation')
    .select('id, spaceId')
    .eq('id', id)
    .maybeSingle();
  if (convErr) return NextResponse.json({ error: 'Lookup failed' }, { status: 500 });
  if (!conv) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
  if ((conv as { spaceId: string }).spaceId !== space.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Insert user message synchronously so the client gets a stable id.
  const { data: userMsg, error: userErr } = await supabase
    .from('TaskMessage')
    .insert({ conversationId: id, role: 'user', content, metadata: null })
    .select('id, conversationId, role, content, metadata, createdAt')
    .single();
  if (userErr || !userMsg) {
    return NextResponse.json({ error: 'Insert failed' }, { status: 500 });
  }

  const dept = classifyDepartment(content);
  const baseMetadata: Record<string, unknown> = { delegatedTo: dept };
  if (dept) {
    baseMetadata.subagentChip = {
      label: `Delegating to ${DEPARTMENT_LABELS[dept]}`,
      department: dept,
    };
  }

  const stream = new ReadableStream({
    async start(controller) {
      // Always announce the user message id so the client can replace
      // its optimistic placeholder.
      controller.enqueue(sseEncode({ userMessageId: (userMsg as { id: string }).id }));

      const apiKey = process.env.OPENAI_API_KEY;
      let fullContent = '';
      let inputTokens = 0;
      let outputTokens = 0;
      let modelUsed = DEFAULT_MODEL;
      let usedFallback = false;

      try {
        if (!apiKey) {
          const canned = cannedAssistantReply(content);
          fullContent = canned.content;
          controller.enqueue(sseEncode({ delta: canned.content }));
          usedFallback = true;
        } else {
          const [memory, missionRow, history] = await Promise.all([
            loadMemoryLayers(space.id, content, MEMORY_TOP_K).catch(() => ({
              core: {},
              working: {},
              recent: [],
            })),
            loadMission(space.id),
            loadRecentHistory(id),
          ]);

          const missionContext: MissionContext = {
            mission: missionRow,
            core: memory.core,
            stage: missionRow?.stage ?? 'idea',
          };

          const ctx = {
            userId,
            space: {
              id: space.id,
              slug: space.slug,
              name: space.name,
              ownerId: space.ownerId,
            },
            signal: new AbortController().signal,
          };

          const systemPrompt = await buildPersonalizedSystemPrompt(ctx, { missionContext });

          const trimmedHistory = trimTrailingDuplicate(history, content);
          const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
            { role: 'system', content: systemPrompt },
          ];
          for (const h of trimmedHistory) {
            if (h.role === 'system') continue;
            messages.push({ role: h.role, content: h.content });
          }
          messages.push({ role: 'user', content });

          const client = new OpenAI({ apiKey });
          const completion = await client.chat.completions.create({
            model: DEFAULT_MODEL,
            messages,
            stream: true,
            stream_options: { include_usage: true },
            max_completion_tokens: 800,
          });

          for await (const chunk of completion) {
            const delta = chunk.choices?.[0]?.delta?.content ?? '';
            if (delta) {
              fullContent += delta;
              controller.enqueue(sseEncode({ delta }));
            }
            if (chunk.usage) {
              inputTokens = chunk.usage.prompt_tokens ?? 0;
              outputTokens = chunk.usage.completion_tokens ?? 0;
            }
          }

          if (!fullContent) {
            fullContent = "I'm trying to think about this but something's off. Try again in a moment.";
            controller.enqueue(sseEncode({ delta: fullContent }));
            usedFallback = true;
          }
        }

        // Persist assistant row.
        const finalMetadata: Record<string, unknown> = {
          ...baseMetadata,
          model: modelUsed,
          inputTokens,
          outputTokens,
        };
        if (usedFallback) finalMetadata.fallback = apiKey ? 'model_error' : 'no_api_key';

        const { data: assistantMsg } = await supabase
          .from('TaskMessage')
          .insert({
            conversationId: id,
            role: 'assistant',
            content: fullContent,
            metadata: finalMetadata,
          })
          .select('id, conversationId, role, content, metadata, createdAt')
          .single();

        if (apiKey && (inputTokens || outputTokens)) {
          void emitCostEvent({
            spaceId: space.id,
            department: dept ?? 'manager',
            model: modelUsed,
            inputTokens,
            outputTokens,
            toolName: 'task-conversation',
          });
        }

        await supabase
          .from('TaskConversation')
          .update({ updatedAt: new Date().toISOString() })
          .eq('id', id);

        controller.enqueue(
          sseEncode({
            done: true,
            messageId: assistantMsg ? (assistantMsg as { id: string }).id : null,
          }),
        );
      } catch (err) {
        logger.error('[task-messages-stream] model failed', {
          err: err instanceof Error ? err.message : String(err),
        });
        controller.enqueue(
          sseEncode({ error: err instanceof Error ? err.message : 'stream failed' }),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}

async function loadMission(spaceId: string): Promise<Mission | null> {
  try {
    const { data } = await supabase
      .from('Mission')
      .select('id, spaceId, title, description, oneLinePitch, targetCustomer, stage, createdAt, updatedAt')
      .eq('spaceId', spaceId)
      .maybeSingle();
    return (data as Mission | null) ?? null;
  } catch {
    return null;
  }
}

async function loadRecentHistory(conversationId: string): Promise<ConvMessageRow[]> {
  try {
    const { data } = await supabase
      .from('TaskMessage')
      .select('role, content, createdAt')
      .eq('conversationId', conversationId)
      .order('createdAt', { ascending: false })
      .limit(HISTORY_LIMIT);
    const rows = (data ?? []) as ConvMessageRow[];
    return rows.slice().reverse();
  } catch {
    return [];
  }
}

function trimTrailingDuplicate(
  history: ConvMessageRow[],
  newUserContent: string,
): ConvMessageRow[] {
  if (history.length === 0) return history;
  const last = history[history.length - 1];
  if (last.role === 'user' && last.content === newUserContent) {
    return history.slice(0, -1);
  }
  return history;
}
