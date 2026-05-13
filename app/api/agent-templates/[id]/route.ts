/**
 * GET    /api/agent-templates/[id]  — full template + its subagents.
 * PATCH  /api/agent-templates/[id]  — update name / customInstructions / triggerType.
 * DELETE /api/agent-templates/[id]  — drop the template and (CASCADE) all subagents.
 *
 * Owner-only via the parent space. The id is the CustomAgent.id.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { requireAuth } from '@/lib/api-auth';
import { getSpaceForUser } from '@/lib/space';
import { isTriggerType, type TriggerType, type SubAgentRole } from '@/lib/agent-templates/catalog';

const NAME_MAX = 100;
const INSTRUCTIONS_MAX = 10_000;

interface SubAgentRow {
  id: string;
  customAgentId: string;
  name: string;
  role: SubAgentRole;
  instructions: string;
  tools: string[];
  order: number;
  createdAt: string;
}

interface RouteCtx {
  params: Promise<{ id: string }>;
}

async function loadOwnedTemplate(id: string, userId: string) {
  const space = await getSpaceForUser(userId);
  if (!space) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };

  const { data: agent, error } = await supabase
    .from('CustomAgent')
    .select('id, spaceId, name, customInstructions, triggerType, kind, createdAt, updatedAt')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    return { error: NextResponse.json({ error: 'Lookup failed' }, { status: 500 }) };
  }
  if (!agent) {
    return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) };
  }
  if (agent.spaceId !== space.id) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }

  return { space, agent };
}

export async function GET(_req: NextRequest, ctx: RouteCtx) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  const { id } = await ctx.params;
  const loaded = await loadOwnedTemplate(id, userId);
  if ('error' in loaded) return loaded.error;
  const { agent } = loaded;

  const { data: subs, error: subErr } = await supabase
    .from('AgentSubAgent')
    .select('id, customAgentId, name, role, instructions, tools, order, createdAt')
    .eq('customAgentId', id)
    .order('order', { ascending: true });

  if (subErr) {
    return NextResponse.json({ error: 'Lookup failed' }, { status: 500 });
  }

  return NextResponse.json({
    template: {
      id: agent.id,
      name: agent.name,
      triggerType: (agent.triggerType ?? 'manual') as TriggerType,
      customInstructions: agent.customInstructions ?? '',
      createdAt: agent.createdAt,
      updatedAt: agent.updatedAt,
    },
    subagents: (subs ?? []) as SubAgentRow[],
  });
}

interface PatchBody {
  name?: unknown;
  triggerType?: unknown;
  customInstructions?: unknown;
}

export async function PATCH(req: NextRequest, ctx: RouteCtx) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  const { id } = await ctx.params;
  const loaded = await loadOwnedTemplate(id, userId);
  if ('error' in loaded) return loaded.error;

  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const update: Record<string, unknown> = { updatedAt: new Date().toISOString() };

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

  if (body.triggerType !== undefined) {
    if (!isTriggerType(body.triggerType)) {
      return NextResponse.json({ error: 'Invalid triggerType' }, { status: 400 });
    }
    update.triggerType = body.triggerType;
  }

  if (body.customInstructions !== undefined) {
    if (typeof body.customInstructions !== 'string') {
      return NextResponse.json(
        { error: 'customInstructions must be a string' },
        { status: 400 },
      );
    }
    if (body.customInstructions.length > INSTRUCTIONS_MAX) {
      return NextResponse.json(
        { error: `customInstructions must be <= ${INSTRUCTIONS_MAX} chars` },
        { status: 400 },
      );
    }
    update.customInstructions = body.customInstructions;
  }

  const { error: updateErr } = await supabase
    .from('CustomAgent')
    .update(update)
    .eq('id', id);

  if (updateErr) {
    return NextResponse.json({ error: 'Update failed' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, ctx: RouteCtx) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  const { id } = await ctx.params;
  const loaded = await loadOwnedTemplate(id, userId);
  if ('error' in loaded) return loaded.error;

  const { error: delErr } = await supabase.from('CustomAgent').delete().eq('id', id);
  if (delErr) {
    return NextResponse.json({ error: 'Delete failed' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
