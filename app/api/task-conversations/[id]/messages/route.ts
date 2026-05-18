/**
 * POST /api/task-conversations/[id]/messages
 *
 * Inserts the caller's message, then calls OpenAI to generate a real
 * assistant reply grounded in Mission + CoreMemory + recent thread
 * history. Persists both rows, emits a CostEvent, and returns them.
 * Falls back to a canned reply if the model call fails — the route
 * never crashes.
 */

import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { ConvexHttpClient } from 'convex/browser';
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
import { api as convexApi } from '@/convex/_generated/api';

const CONTENT_MAX = 4000;
const DEFAULT_MODEL = 'gpt-5-mini';
const FALLBACK_MODEL = 'gpt-4o-mini';
const HISTORY_LIMIT = 20;
const MEMORY_TOP_K = 8;
const MODEL_TIMEOUT_MS = 30_000;
const FALLBACK_REPLY =
  "I'm trying to think about this but something's off. Try again in a moment.";

const MUTATION_VERBS = [
  'deploy', 'push', 'send', 'post', 'publish', 'launch',
  'merge', 'delete', 'remove', 'create', 'commit',
];

interface PostBody {
  content?: unknown;
  metadata?: unknown;
}

interface ConvMessageRow {
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: string;
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

  // Ownership check.
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

  // Build the real assistant reply. Wrapped in try/catch — never crash.
  const assistantPayload = await generateAssistantReply({
    userId,
    spaceId: space.id,
    spaceName: space.name,
    spaceSlug: space.slug,
    spaceOwnerId: space.ownerId,
    conversationId: id,
    userContent: content,
  });

  const { data: assistantMsg, error: asErr } = await supabase
    .from('TaskMessage')
    .insert({
      conversationId: id,
      role: 'assistant',
      content: assistantPayload.content,
      metadata: assistantPayload.metadata,
    })
    .select('id, conversationId, role, content, metadata, createdAt')
    .single();
  if (asErr || !assistantMsg) {
    return NextResponse.json({ error: 'Assistant insert failed' }, { status: 500 });
  }

  // Bump updatedAt — best effort.
  await supabase
    .from('TaskConversation')
    .update({ updatedAt: new Date().toISOString() })
    .eq('id', id);

  // Dual-write to Convex so other connected tabs see the turn live.
  // Supabase is the audit-of-record (already written above), so Convex
  // rows are marked persisted on insert. The Convex insert returns its
  // _id; we roll that back onto the Supabase rows so the audit-backfill
  // cron can dedupe deterministically via TaskMessage.convexMessageId.
  // Best effort — Convex outages never break the API contract; rows
  // simply land in Supabase without a convexMessageId.
  await mirrorToConvex({
    conversationId: id,
    spaceId: space.id,
    user: {
      supabaseId: (userMsg as { id: string }).id,
      content,
      metadata,
    },
    assistant: {
      supabaseId: (assistantMsg as { id: string }).id,
      content: assistantPayload.content,
      metadata: assistantPayload.metadata,
    },
  });

  return NextResponse.json({ user: userMsg, assistant: assistantMsg });
}

interface MirrorArgs {
  conversationId: string;
  spaceId: string;
  user: {
    supabaseId: string;
    content: string;
    metadata: Record<string, unknown> | null;
  };
  assistant: {
    supabaseId: string;
    content: string;
    metadata: Record<string, unknown>;
  };
}

/**
 * Fan the two new messages into Convex liveMessages, then write the
 * returned Convex _id back onto each Supabase row's convexMessageId
 * column. Marks each Convex row as already persisted to Supabase since
 * the durable write above already succeeded. No-op (graceful degrade)
 * when NEXT_PUBLIC_CONVEX_URL is unset, and per-side try/catch so a
 * single failure can't take down the contract.
 */
async function mirrorToConvex(args: MirrorArgs): Promise<void> {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  const secret = process.env.CONVEX_SERVICE_SECRET;
  if (!url || !secret) return;

  const client = new ConvexHttpClient(url);

  const mirrorOne = async (side: 'user' | 'assistant') => {
    const payload =
      side === 'user'
        ? {
            role: 'user' as const,
            content: args.user.content,
            metadata: args.user.metadata ?? undefined,
            supabaseId: args.user.supabaseId,
          }
        : {
            role: 'assistant' as const,
            content: args.assistant.content,
            metadata: args.assistant.metadata,
            supabaseId: args.assistant.supabaseId,
          };
    try {
      const convexId = (await client.mutation(
        convexApi.liveMessagesServer.mirrorMessage,
        {
          serviceSecret: secret,
          conversationId: args.conversationId,
          spaceId: args.spaceId,
          role: payload.role,
          content: payload.content,
          metadata: payload.metadata,
        },
      )) as string | undefined;
      if (!convexId) return;
      const { error } = await supabase
        .from('TaskMessage')
        .update({ convexMessageId: convexId })
        .eq('id', payload.supabaseId);
      if (error) {
        logger.warn('[task-messages] convexMessageId writeback failed', {
          err: error.message,
          supabaseId: payload.supabaseId,
        });
      }
    } catch (err) {
      logger.warn('[task-messages] convex mirror failed', {
        err: err instanceof Error ? err.message : String(err),
        conversationId: args.conversationId,
        side,
      });
    }
  };

  await Promise.all([mirrorOne('user'), mirrorOne('assistant')]);
}

/**
 * Compose the assistant reply using OpenAI, grounded in mission + core
 * memory + recent thread history. Returns a canned fallback on any error
 * — the route layer above never crashes on a model failure.
 */
async function generateAssistantReply(args: {
  userId: string;
  spaceId: string;
  spaceName: string;
  spaceSlug: string;
  spaceOwnerId: string;
  conversationId: string;
  userContent: string;
}): Promise<{
  content: string;
  metadata: Record<string, unknown>;
}> {
  const dept = classifyDepartment(args.userContent);
  const baseMetadata: Record<string, unknown> = { delegatedTo: dept };
  if (dept) {
    baseMetadata.subagentChip = {
      label: `Delegating to ${DEPARTMENT_LABELS[dept]}`,
      department: dept,
    };
  }

  // Mutation-request warning log. Per v1 spec we don't block, just observe.
  const lower = args.userContent.toLowerCase();
  if (MUTATION_VERBS.some((v) => lower.includes(v))) {
    logger.warn('[task-messages] possible mutation request', {
      spaceId: args.spaceId,
      conversationId: args.conversationId,
    });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    const canned = cannedAssistantReply(args.userContent);
    return {
      content: canned.content,
      metadata: { ...baseMetadata, ...canned.metadata, fallback: 'no_api_key' },
    };
  }

  try {
    // Parallelize the three lookups: memory layers, mission row, recent history.
    const [memory, missionRow, history] = await Promise.all([
      loadMemoryLayers(args.spaceId, args.userContent, MEMORY_TOP_K).catch((err) => {
        logger.warn('[task-messages] memory load failed', {
          err: err instanceof Error ? err.message : String(err),
        });
        return { core: {}, working: {}, recent: [] };
      }),
      loadMission(args.spaceId),
      loadRecentHistory(args.conversationId),
    ]);

    const stage = missionRow?.stage ?? 'idea';
    const missionContext: MissionContext = {
      mission: missionRow,
      core: memory.core,
      stage,
    };

    const ctx = {
      userId: args.userId,
      space: {
        id: args.spaceId,
        slug: args.spaceSlug,
        name: args.spaceName,
        ownerId: args.spaceOwnerId,
      },
      signal: new AbortController().signal,
    };

    const systemPrompt = await buildPersonalizedSystemPrompt(ctx, { missionContext });

    // Build messages: system → trimmed history → new user turn. We rely on
    // the user message having already been inserted, but loadRecentHistory
    // may or may not include it depending on read timing — dedupe by
    // dropping the trailing user message if it matches our current content.
    const trimmedHistory = trimTrailingDuplicate(history, args.userContent);

    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: systemPrompt },
    ];
    for (const h of trimmedHistory) {
      if (h.role === 'system') continue;
      messages.push({ role: h.role, content: h.content });
    }
    messages.push({ role: 'user', content: args.userContent });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), MODEL_TIMEOUT_MS);

    let response;
    let modelUsed = DEFAULT_MODEL;
    try {
      const client = new OpenAI({ apiKey });
      response = await client.chat.completions.create(
        {
          model: DEFAULT_MODEL,
          messages,
          max_completion_tokens: 800,
        },
        { signal: controller.signal },
      );
    } catch (primaryErr) {
      logger.warn('[task-messages] primary model failed; retrying with fallback', {
        err: primaryErr instanceof Error ? primaryErr.message : String(primaryErr),
      });
      const client = new OpenAI({ apiKey });
      response = await client.chat.completions.create(
        {
          model: FALLBACK_MODEL,
          messages,
          max_completion_tokens: 800,
        },
        { signal: controller.signal },
      );
      modelUsed = FALLBACK_MODEL;
    } finally {
      clearTimeout(timer);
    }

    const raw = response.choices?.[0]?.message?.content?.trim();
    if (!raw) throw new Error('Empty model response');

    const usage = response.usage ?? { prompt_tokens: 0, completion_tokens: 0 };
    const inputTokens = usage.prompt_tokens ?? 0;
    const outputTokens = usage.completion_tokens ?? 0;

    // Cost event — fire and forget; never blocks the response.
    void emitCostEvent({
      spaceId: args.spaceId,
      department: dept ?? 'manager',
      model: modelUsed,
      inputTokens,
      outputTokens,
      toolName: 'task-conversation',
    });

    return {
      content: raw,
      metadata: {
        ...baseMetadata,
        model: modelUsed,
        inputTokens,
        outputTokens,
      },
    };
  } catch (err) {
    logger.error('[task-messages] model call failed; falling back to canned reply', {
      err: err instanceof Error ? err.message : String(err),
      spaceId: args.spaceId,
    });
    return {
      content: FALLBACK_REPLY,
      metadata: { ...baseMetadata, fallback: 'model_error' },
    };
  }
}

async function loadMission(spaceId: string): Promise<Mission | null> {
  try {
    const { data } = await supabase
      .from('Mission')
      .select('id, spaceId, title, description, oneLinePitch, targetCustomer, stage, createdAt, updatedAt')
      .eq('spaceId', spaceId)
      .maybeSingle();
    return (data as Mission | null) ?? null;
  } catch (err) {
    logger.warn('[task-messages] mission load failed', {
      err: err instanceof Error ? err.message : String(err),
    });
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
  } catch (err) {
    logger.warn('[task-messages] history load failed', {
      err: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

/**
 * If the most recent history row is the same user content we're about to
 * send (it was just inserted), drop it so we don't pass it twice.
 */
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
