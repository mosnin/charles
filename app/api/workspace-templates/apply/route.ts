/**
 * POST /api/workspace-templates/apply
 *
 * Apply a workspace template to the caller's space:
 *   - Mission: fill ONLY empty fields. Never overwrite founder-set values.
 *   - CoreMemory: upsert each slot via (spaceId, slot) UNIQUE.
 *   - StageGate: insert each (stage, title) only if a row for that pair
 *     doesn't already exist for the space (idempotent re-apply).
 *   - Document: upsert content ONLY for documents whose content is empty
 *     (or whose row doesn't exist yet).
 *
 * Rate limit: 4 applies per space per day, in-memory bucket. The founder
 * shouldn't be able to thrash mission + gates + docs in a loop. If they
 * really need more, they ask. Process restart resets the bucket — fine.
 *
 * Body: { templateSlug: WorkspaceTemplateSlug }
 *
 * 200: { applied: true, addedGates: number, addedDocs: number, updatedMission: boolean }
 * 400: malformed body / unknown template
 * 401: unauthenticated
 * 403: caller has no space
 * 429: rate limit exceeded
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { requireAuth } from '@/lib/api-auth';
import { getSpaceForUser } from '@/lib/space';
import {
  getWorkspaceTemplate,
  isWorkspaceTemplateSlug,
  type WorkspaceTemplate,
} from '@/lib/workspace-templates/catalog';
import { getDocument } from '@/lib/documents/catalog';

import { checkAndRecordApply } from '@/lib/workspace-templates/rate-limit';

// ── Handler ─────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  let body: { templateSlug?: unknown };
  try {
    body = (await req.json()) as { templateSlug?: unknown };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!isWorkspaceTemplateSlug(body.templateSlug)) {
    return NextResponse.json(
      { error: 'Unknown template' },
      { status: 400 },
    );
  }
  const template = getWorkspaceTemplate(body.templateSlug);
  if (!template) {
    // Belt and braces. isWorkspaceTemplateSlug should prevent this.
    return NextResponse.json({ error: 'Unknown template' }, { status: 400 });
  }

  const space = await getSpaceForUser(userId);
  if (!space) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  if (!checkAndRecordApply(space.id, Date.now())) {
    return NextResponse.json(
      { error: 'Too many template applies. Try again tomorrow.' },
      { status: 429 },
    );
  }

  // ── 1. Mission: fill only empty fields ────────────────────────────────────
  const updatedMission = await applyMission(space.id, template);

  // ── 2. CoreMemory: upsert all slots ───────────────────────────────────────
  await applyCoreMemory(space.id, template);

  // ── 3. StageGate: insert pairs that don't already exist ───────────────────
  const addedGates = await applyExtraGates(space.id, template);

  // ── 4. Documents: only fill empty ones ────────────────────────────────────
  const addedDocs = await applyDocumentSeeds(space.id, template);

  return NextResponse.json({
    applied: true,
    addedGates,
    addedDocs,
    updatedMission,
  });
}

// ── Helpers ─────────────────────────────────────────────────────────────────

async function applyMission(
  spaceId: string,
  template: WorkspaceTemplate,
): Promise<boolean> {
  const { data: row } = await supabase
    .from('Mission')
    .select('title, description, oneLinePitch, targetCustomer')
    .eq('spaceId', spaceId)
    .maybeSingle();

  const existing = (row ?? {}) as {
    title?: string | null;
    description?: string | null;
    oneLinePitch?: string | null;
    targetCustomer?: string | null;
  };

  const updates: Record<string, string> = {};
  const { mission } = template;

  if (mission.title && !existing.title?.trim()) {
    updates.title = mission.title;
  }
  if (mission.productDescription && !existing.description?.trim()) {
    updates.description = mission.productDescription;
  }
  if (mission.oneLinePitch && !existing.oneLinePitch?.trim()) {
    updates.oneLinePitch = mission.oneLinePitch;
  }
  if (mission.targetCustomer && !existing.targetCustomer?.trim()) {
    updates.targetCustomer = mission.targetCustomer;
  }

  if (Object.keys(updates).length === 0) return false;

  await supabase
    .from('Mission')
    .update({ ...updates, updatedAt: new Date().toISOString() })
    .eq('spaceId', spaceId);

  return true;
}

async function applyCoreMemory(
  spaceId: string,
  template: WorkspaceTemplate,
): Promise<void> {
  const slots = Object.entries(template.coreMemorySeeds).map(([slot, value]) => ({
    spaceId,
    slot,
    value,
  }));
  if (slots.length === 0) return;
  await supabase
    .from('CoreMemory')
    .upsert(slots, { onConflict: 'spaceId,slot' });
}

async function applyExtraGates(
  spaceId: string,
  template: WorkspaceTemplate,
): Promise<number> {
  // Load existing (stage, title) pairs for this space once.
  const { data: existingRows } = await supabase
    .from('StageGate')
    .select('stage, title')
    .eq('spaceId', spaceId);

  const existing = new Set<string>(
    (existingRows ?? []).map(
      (r: { stage: string; title: string }) => `${r.stage}|${r.title}`,
    ),
  );

  const toInsert: Array<{ spaceId: string; stage: string; title: string; order: number }> = [];
  for (const [stage, titles] of Object.entries(template.extraGates)) {
    if (!titles) continue;
    titles.forEach((title, i) => {
      const key = `${stage}|${title}`;
      if (existing.has(key)) return;
      existing.add(key);
      // Order = 100+i so templated gates sit after the catalog defaults.
      toInsert.push({ spaceId, stage, title, order: 100 + i });
    });
  }

  if (toInsert.length === 0) return 0;
  const { error } = await supabase.from('StageGate').insert(toInsert);
  if (error) {
    console.warn('[workspace-templates/apply] gate insert warning', error);
    return 0;
  }
  return toInsert.length;
}

async function applyDocumentSeeds(
  spaceId: string,
  template: WorkspaceTemplate,
): Promise<number> {
  const seeds = Object.entries(template.documentSeeds);
  if (seeds.length === 0) return 0;

  // Read existing rows for the seeded slugs in one go.
  const slugs = seeds.map(([slug]) => slug);
  const { data: rows } = await supabase
    .from('Document')
    .select('slug, content')
    .eq('spaceId', spaceId)
    .in('slug', slugs);

  const filled = new Set<string>(
    ((rows ?? []) as Array<{ slug: string; content?: string | null }>)
      .filter((r) => (r.content ?? '').trim().length > 0)
      .map((r) => r.slug),
  );

  const now = new Date().toISOString();
  const toUpsert: Array<{
    spaceId: string;
    slug: string;
    title: string;
    content: string;
    updatedAt: string;
  }> = [];

  for (const [slug, content] of seeds) {
    if (!content) continue;
    if (filled.has(slug)) continue;
    const def = getDocument(slug);
    if (!def) continue; // catalog mismatch — skip rather than insert garbage
    toUpsert.push({
      spaceId,
      slug,
      title: def.title,
      content,
      updatedAt: now,
    });
  }

  if (toUpsert.length === 0) return 0;

  const { error } = await supabase
    .from('Document')
    .upsert(toUpsert, { onConflict: 'spaceId,slug' });
  if (error) {
    console.warn('[workspace-templates/apply] document upsert warning', error);
    return 0;
  }
  return toUpsert.length;
}

