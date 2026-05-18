/**
 * POST /api/agent-templates/[id]/subagents — add a subagent to a template.
 *
 * Body: { name, role, instructions?, tools?[] }
 *
 * Tools are validated against the canonical ALL_TOOLS registry. Unknown
 * names get rejected with a 400 and the missing list, so the UI can show
 * the founder exactly what they typed wrong instead of an opaque error.
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

interface PostBody {
  name?: unknown;
  role?: unknown;
  instructions?: unknown;
  tools?: unknown;
}

interface RouteCtx {
  params: Promise<{ id: string }>;
}

function knownToolNames(): Set<string> {
  return new Set(ALL_TOOLS.map((t) => t.name));
}

export async function POST(req: NextRequest, ctx: RouteCtx) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  const space = await getSpaceForUser(userId);
  if (!space) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await ctx.params;

  const { data: agent, error: agentErr } = await supabase
    .from('CustomAgent')
    .select('id, spaceId')
    .eq('id', id)
    .maybeSingle();

  if (agentErr) {
    return NextResponse.json({ error: 'Lookup failed' }, { status: 500 });
  }
  if (!agent) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (agent.spaceId !== space.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (typeof body.name !== 'string') {
    return NextResponse.json({ error: 'name (string) is required' }, { status: 400 });
  }
  const name = body.name.trim();
  if (name.length === 0) {
    return NextResponse.json({ error: 'name cannot be empty' }, { status: 400 });
  }
  if (name.length > NAME_MAX) {
    return NextResponse.json({ error: `name must be <= ${NAME_MAX} chars` }, { status: 400 });
  }

  if (typeof body.role !== 'string' || !isSubAgentRole(body.role)) {
    return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
  }
  const role: SubAgentRole = body.role;

  let instructions = '';
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
    instructions = body.instructions;
  }

  let tools: string[] = [];
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
      return NextResponse.json(
        { error: 'Unknown tools', missing },
        { status: 400 },
      );
    }
    // Dedupe while preserving order.
    tools = Array.from(new Set(body.tools as string[]));
  }

  // Order = max(existing) + 1, so new subagents stack on the right end.
  const { data: maxRow } = await supabase
    .from('AgentSubAgent')
    .select('order')
    .eq('customAgentId', id)
    .order('order', { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextOrder =
    maxRow && typeof (maxRow as { order: number }).order === 'number'
      ? (maxRow as { order: number }).order + 1
      : 0;

  const { data: inserted, error: insertErr } = await supabase
    .from('AgentSubAgent')
    .insert({
      customAgentId: id,
      name,
      role,
      instructions,
      tools,
      order: nextOrder,
    })
    .select('id, customAgentId, name, role, instructions, tools, order, createdAt')
    .single();

  if (insertErr || !inserted) {
    return NextResponse.json({ error: 'Insert failed' }, { status: 500 });
  }

  return NextResponse.json(inserted);
}
