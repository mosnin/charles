/**
 * POST /api/documents/product-prd/generate — draft a Product PRD from mission.
 *
 * Pulls Mission + CoreMemory + brand-kit (if present), assembles the prompt,
 * asks gpt-5 for markdown, and UPSERTs the product-prd document. Caps at 5
 * generations per space per hour via a process-local bucket. Emits a CostEvent
 * on success. Founder-initiated only — never call from page load.
 *
 * 200: { content, updatedAt }
 * 401: unauthenticated
 * 403: caller has no workspace
 * 429: hourly cap exceeded
 * 500: db failure
 * 502: model upstream failed
 */

import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { requireAuth } from '@/lib/api-auth';
import { getSpaceForUser } from '@/lib/space';
import { supabase } from '@/lib/supabase';
import { getDocument } from '@/lib/documents/catalog';
import {
  buildPrdSystemPrompt,
  buildPrdUserPrompt,
  type PrdInput,
} from '@/lib/documents/prd-template';
import { loadMemoryLayers } from '@/lib/agent-memory/layers';
import { emitCostEvent } from '@/lib/observability/cost-events';
import { checkAndRecord, MAX_PER_HOUR } from './_buckets';

const PRIMARY_MODEL = 'gpt-5';
const FALLBACK_MODEL = 'gpt-5-mini';

interface MissionRow {
  title: string | null;
  oneLinePitch: string | null;
  targetCustomer: string | null;
  description: string | null;
}

interface DocRow {
  content: string | null;
}

export async function POST(_req: NextRequest) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  const space = await getSpaceForUser(userId);
  if (!space) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const gate = checkAndRecord(space.id, Date.now());
  if (!gate.ok) {
    return NextResponse.json(
      {
        error: `Too many generations this hour. Limit is ${MAX_PER_HOUR}. Wait and try again.`,
      },
      { status: 429 },
    );
  }

  // Load grounding context in parallel. All three reads are best-effort —
  // a missing mission/brand-kit is allowed; the prompt fills with (not set).
  const [missionRes, brandKitRes, memory] = await Promise.all([
    supabase
      .from('Mission')
      .select('title, oneLinePitch, targetCustomer, description')
      .eq('spaceId', space.id)
      .maybeSingle(),
    supabase
      .from('Document')
      .select('content')
      .eq('spaceId', space.id)
      .eq('slug', 'brand-kit')
      .maybeSingle(),
    loadMemoryLayers(space.id).catch(() => ({
      core: {} as Record<string, string | null>,
      working: {},
      recent: [],
    })),
  ]);

  const mission = (missionRes.data as MissionRow | null) ?? null;
  const brandKit = (brandKitRes.data as DocRow | null) ?? null;

  const input: PrdInput = {
    workspaceName: space.name ?? space.slug ?? '',
    missionTitle: mission?.title ?? null,
    oneLinePitch: mission?.oneLinePitch ?? null,
    targetCustomer: mission?.targetCustomer ?? null,
    productDescription: mission?.description ?? null,
    brandVoice: extractBrandVoice(brandKit?.content ?? null),
    coreMemorySlots: memory.core ?? {},
  };

  const systemPrompt = buildPrdSystemPrompt();
  const userPrompt = buildPrdUserPrompt(input);

  let content = '';
  let usedModel = PRIMARY_MODEL;
  let usage = { inputTokens: 0, outputTokens: 0 };
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'OpenAI is not configured for this environment.' },
      { status: 502 },
    );
  }

  try {
    const client = new OpenAI({ apiKey });
    const result = await callModel(client, PRIMARY_MODEL, systemPrompt, userPrompt);
    content = result.content;
    usage = result.usage;
  } catch (err) {
    // Single fallback to mini. If that also fails we 502 — no third attempt.
    try {
      const client = new OpenAI({ apiKey });
      const result = await callModel(client, FALLBACK_MODEL, systemPrompt, userPrompt);
      content = result.content;
      usage = result.usage;
      usedModel = FALLBACK_MODEL;
    } catch (fallbackErr) {
      const msg =
        fallbackErr instanceof Error
          ? fallbackErr.message
          : err instanceof Error
            ? err.message
            : 'Model call failed.';
      return NextResponse.json({ error: msg }, { status: 502 });
    }
  }

  if (!content || content.trim().length === 0) {
    return NextResponse.json(
      { error: 'Model returned an empty draft.' },
      { status: 502 },
    );
  }

  const def = getDocument('product-prd');
  if (!def) {
    // Defensive — catalog is locked at compile time but keep the check.
    return NextResponse.json({ error: 'Unknown document' }, { status: 500 });
  }

  const updatedAt = new Date().toISOString();
  const { data: upserted, error: upsertErr } = await supabase
    .from('Document')
    .upsert(
      {
        spaceId: space.id,
        slug: def.slug,
        title: def.title,
        content,
        updatedAt,
      },
      { onConflict: 'spaceId,slug' },
    )
    .select('updatedAt')
    .single();

  if (upsertErr || !upserted) {
    return NextResponse.json({ error: 'Save failed' }, { status: 500 });
  }

  // Best-effort cost log — never let a logging failure break the response.
  void emitCostEvent({
    spaceId: space.id,
    department: 'engineering',
    model: usedModel,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    toolName: 'product-prd.generate',
  });

  return NextResponse.json({
    content,
    updatedAt: (upserted as { updatedAt: string }).updatedAt,
  });
}

interface ModelCallResult {
  content: string;
  usage: { inputTokens: number; outputTokens: number };
}

async function callModel(
  client: OpenAI,
  model: string,
  systemPrompt: string,
  userPrompt: string,
): Promise<ModelCallResult> {
  const completion = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  });

  const raw = completion.choices?.[0]?.message?.content ?? '';
  const content = stripCodeFence(raw).trim();
  const usage = {
    inputTokens: completion.usage?.prompt_tokens ?? 0,
    outputTokens: completion.usage?.completion_tokens ?? 0,
  };
  return { content, usage };
}

/** Defensive: if the model ignored the "no code fences" instruction and
 *  wrapped the doc in ```markdown ... ```, peel one layer. */
function stripCodeFence(s: string): string {
  const m = s.match(/^\s*```(?:markdown|md)?\n([\s\S]*?)\n```\s*$/);
  return m ? m[1]! : s;
}

/** Pull the "Voice" section out of the brand-kit markdown. Cheap heuristic:
 *  grab everything between `## Voice` and the next `## ` heading. Returns
 *  null when no brand-kit exists or no voice section is found. */
function extractBrandVoice(brandKitMarkdown: string | null): string | null {
  if (!brandKitMarkdown) return null;
  const m = brandKitMarkdown.match(/##\s+Voice\s*\n([\s\S]*?)(?=\n##\s|\n#\s|$)/i);
  if (!m) return null;
  const block = m[1]!.trim();
  return block.length > 0 ? block : null;
}
