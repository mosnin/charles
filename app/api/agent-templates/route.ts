/**
 * GET  /api/agent-templates — list custom agent templates for the caller's
 *                             workspace, with subagent counts.
 * POST /api/agent-templates — create a new template (name + triggerType
 *                             + customInstructions). Returns `{ id }`.
 *
 * "Template" here is a CustomAgent row with kind='custom'. We don't
 * surface department-bound agents (kind='department') here — those live
 * under settings/departments. Owner-only, mirrors documents-route auth.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { requireAuth } from '@/lib/api-auth';
import { getSpaceForUser } from '@/lib/space';
import { isTriggerType, type TriggerType } from '@/lib/agent-templates/catalog';

const NAME_MAX = 100;
const INSTRUCTIONS_MAX = 10_000;

interface TemplateRow {
  id: string;
  spaceId: string;
  name: string;
  systemPrompt: string;
  customInstructions: string | null;
  triggerType: TriggerType | null;
  createdAt: string;
  updatedAt: string;
}

export async function GET() {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  const space = await getSpaceForUser(userId);
  if (!space) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { data, error } = await supabase
    .from('CustomAgent')
    .select('id, spaceId, name, systemPrompt, customInstructions, triggerType, createdAt, updatedAt')
    .eq('spaceId', space.id)
    .eq('kind', 'custom')
    .order('createdAt', { ascending: false });

  if (error) {
    return NextResponse.json({ error: 'Lookup failed' }, { status: 500 });
  }

  const rows = (data ?? []) as TemplateRow[];

  // Fetch subagent counts. Batch a single query rather than N round-trips.
  let countsByAgent: Record<string, number> = {};
  if (rows.length > 0) {
    const ids = rows.map((r) => r.id);
    const { data: subRows, error: subErr } = await supabase
      .from('AgentSubAgent')
      .select('customAgentId')
      .in('customAgentId', ids);
    if (subErr) {
      return NextResponse.json({ error: 'Lookup failed' }, { status: 500 });
    }
    countsByAgent = ((subRows ?? []) as { customAgentId: string }[]).reduce(
      (acc, r) => {
        acc[r.customAgentId] = (acc[r.customAgentId] ?? 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );
  }

  const templates = rows.map((r) => ({
    id: r.id,
    name: r.name,
    triggerType: (r.triggerType ?? 'manual') as TriggerType,
    customInstructions: r.customInstructions ?? '',
    subagentCount: countsByAgent[r.id] ?? 0,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));

  return NextResponse.json({ templates });
}

interface PostBody {
  name?: unknown;
  triggerType?: unknown;
  customInstructions?: unknown;
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

  let triggerType: TriggerType = 'manual';
  if (body.triggerType !== undefined) {
    if (!isTriggerType(body.triggerType)) {
      return NextResponse.json({ error: 'Invalid triggerType' }, { status: 400 });
    }
    triggerType = body.triggerType;
  }

  let customInstructions = '';
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
    customInstructions = body.customInstructions;
  }

  const { data: inserted, error: insertErr } = await supabase
    .from('CustomAgent')
    .insert({
      spaceId: space.id,
      name,
      kind: 'custom',
      systemPrompt: '',
      customInstructions,
      triggerType,
    })
    .select('id')
    .single();

  if (insertErr || !inserted) {
    return NextResponse.json({ error: 'Insert failed' }, { status: 500 });
  }

  return NextResponse.json({ id: (inserted as { id: string }).id });
}
