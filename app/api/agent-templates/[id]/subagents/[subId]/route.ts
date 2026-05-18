/**
 * PATCH  /api/agent-templates/[id]/subagents/[subId]  — update or reorder.
 * DELETE /api/agent-templates/[id]/subagents/[subId]  — drop a subagent.
 *
 * Reorder happens through the same PATCH endpoint by sending `order`. The
 * caller decides the new index; we accept it verbatim. Compacting / gap
 * cleanup is the UI's job — the index column is just a sort key.
 *
 * Owner-only through the parent CustomAgent → Space chain.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { requireAuth } from '@/lib/api-auth';
import { getSpaceForUser } from '@/lib/space';
import { ALL_TOOLS } from '@/lib/ai-tools/tools';
import { isSubAgentRole, type SubAgentRole } from '@/lib/agent-templates/catalog';

const NAME_MAX = 100;
const INSTRUCTIONS_MAX = 10_000;
const TOOLS_MAX = 50;

interface RouteCtx {
  params: Promise<{ id: string; subId: string }>;
}

interface PatchBody {
  name?: unknown;
  role?: unknown;
  instructions?: unknown;
  tools?: unknown;
  order?: unknown;
}

function knownToolNames(): Set<string> {
  return new Set(ALL_TOOLS.map((t) => t.name));
}

type AuthOwnsResult =
  | { error: NextResponse; space?: undefined; agent?: undefined }
  | { error?: undefined; space: { id: string }; agent: { id: string; spaceId: string } };

async function authOwnsAgent(agentId: string, userId: string): Promise<AuthOwnsResult> {
  const space = await getSpaceForUser(userId);
  if (!space) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };

  const { data: agent, error } = await supabase
    .from('CustomAgent')
    .select('id, spaceId')
    .eq('id', agentId)
    .maybeSingle();

  if (error) return { error: NextResponse.json({ error: 'Lookup failed' }, { status: 500 }) };
  if (!agent) return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) };
  if ((agent as { spaceId: string }).spaceId !== space.id) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }
  return { space: { id: space.id }, agent: agent as { id: string; spaceId: string } };
}

export async function PATCH(req: NextRequest, ctx: RouteCtx): Promise<NextResponse> {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  const { id, subId } = await ctx.params;
  const owned = await authOwnsAgent(id, userId);
  if (owned.error) return owned.error;

  // Confirm subagent belongs to this parent.
  const { data: sub, error: subErr } = await supabase
    .from('AgentSubAgent')
    .select('id, customAgentId')
    .eq('id', subId)
    .maybeSingle();
  if (subErr) {
    return NextResponse.json({ error: 'Lookup failed' }, { status: 500 });
  }
  if (!sub || sub.customAgentId !== id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const update: Record<string, unknown> = {};

  if (body.name !== undefined) {
    if (typeof body.name !== 'string') {
      return NextResponse.json({ error: 'name must be a string' }, { status: 400 });
    }
    const trimmed = body.name.trim();
    if (trimmed.length === 0) {
      return NextResponse.json({ error: 'name cannot be empty' }, { status: 400 });
    }
    if (trimmed.length > NAME_MAX) {
      return NextResponse.json({ error: `name must be <= ${NAME_MAX} chars` }, { status: 400 });
    }
    update.name = trimmed;
  }

  if (body.role !== undefined) {
    if (typeof body.role !== 'string' || !isSubAgentRole(body.role)) {
      return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
    }
    update.role = body.role as SubAgentRole;
  }

  if (body.instructions !== undefined) {
    if (typeof body.instructions !== 'string') {
      return NextResponse.json({ error: 'instructions must be a string' }, { status: 400 });
    }
    if (body.instructions.length > INSTRUCTIONS_MAX) {
      return NextResponse.json(
        { error: `instructions must be <= ${INSTRUCTIONS_MAX} chars` },
        { status: 400 },
      );
    }
    update.instructions = body.instructions;
  }

  if (body.tools !== undefined) {
    if (!Array.isArray(body.tools)) {
      return NextResponse.json({ error: 'tools must be an array of strings' }, { status: 400 });
    }
    if (body.tools.length > TOOLS_MAX) {
      return NextResponse.json({ error: `tools must have <= ${TOOLS_MAX} entries` }, { status: 400 });
    }
    if (!body.tools.every((t) => typeof t === 'string')) {
      return NextResponse.json({ error: 'tools must be strings' }, { status: 400 });
    }
    const known = knownToolNames();
    const missing = (body.tools as string[]).filter((t) => !known.has(t));
    if (missing.length > 0) {
      return NextResponse.json({ error: 'Unknown tools', missing }, { status: 400 });
    }
    update.tools = Array.from(new Set(body.tools as string[]));
  }

  if (body.order !== undefined) {
    if (typeof body.order !== 'number' || !Number.isInteger(body.order)) {
      return NextResponse.json({ error: 'order must be an integer' }, { status: 400 });
    }
    if (body.order < 0) {
      return NextResponse.json({ error: 'order must be >= 0' }, { status: 400 });
    }
    update.order = body.order;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  }

  const { error: updateErr } = await supabase
    .from('AgentSubAgent')
    .update(update)
    .eq('id', subId);

  if (updateErr) {
    return NextResponse.json({ error: 'Update failed' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, ctx: RouteCtx): Promise<NextResponse> {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  const { id, subId } = await ctx.params;
  const owned = await authOwnsAgent(id, userId);
  if (owned.error) return owned.error;

  const { data: sub, error: subErr } = await supabase
    .from('AgentSubAgent')
    .select('id, customAgentId')
    .eq('id', subId)
    .maybeSingle();
  if (subErr) {
    return NextResponse.json({ error: 'Lookup failed' }, { status: 500 });
  }
  if (!sub || sub.customAgentId !== id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const { error: delErr } = await supabase.from('AgentSubAgent').delete().eq('id', subId);
  if (delErr) {
    return NextResponse.json({ error: 'Delete failed' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
