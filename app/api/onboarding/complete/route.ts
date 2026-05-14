/**
 * POST /api/onboarding/complete
 *
 * Finalises Charles onboarding:
 *   1. Authenticates user via Clerk.
 *   2. Resolves the user's Space.
 *   3. Calls seed_charles_workspace(spaceId) via Supabase RPC.
 *   4. Upserts CoreMemory slots with the collected wizard data.
 *   5. Updates the Mission title, oneLinePitch, and the three new founder-
 *      profile columns (ideaStage, founderRole, technicalExperience).
 *   6. Resolves the effective workspace template slug: explicit > auto-pick
 *      from stage > default. Returned in the response for the client to
 *      apply against /api/workspace-templates/apply.
 *   7. Marks the user as onboarded.
 *
 * Backwards compatible: every new field is optional. Old callers that send
 * only { companyName, tagline, founderName, whatBuilding, oneLinePitch,
 * targetCustomer, githubConnected, templateSlug } still work.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/api-auth';
import { supabase } from '@/lib/supabase';
import {
  autoPickTemplateForStage,
  FOUNDER_IDEA_STAGES,
  type FounderIdeaStage,
} from '@/lib/workspace-templates/auto-pick';
import { isWorkspaceTemplateSlug } from '@/lib/workspace-templates/catalog';
import { buildFirstMessage } from '@/lib/onboarding/first-message';

const FOUNDER_ROLES = [
  'product',
  'engineering',
  'design',
  'marketing',
  'sales',
  'operations',
  'founder',
  'other',
] as const;

const TECHNICAL_EXPERIENCE = [
  'writes-code',
  'manages-engineers',
  'non-technical',
] as const;

const BodySchema = z.object({
  // Existing fields (back-compat).
  companyName: z.string().optional(),
  tagline: z.string().optional(),
  founderName: z.string().optional(),
  whatBuilding: z.string().optional(),
  oneLinePitch: z.string().optional(),
  targetCustomer: z.string().optional(),
  githubConnected: z.boolean().optional(),
  githubSkipped: z.boolean().optional(),
  templateSlug: z.string().optional(),

  // New founder-profile signals.
  ideaStage: z.enum(FOUNDER_IDEA_STAGES as readonly [string, ...string[]]).optional(),
  founderRole: z.enum(FOUNDER_ROLES).optional(),
  technicalExperience: z.enum(TECHNICAL_EXPERIENCE).optional(),
});

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { userId } = auth;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid body', details: parsed.error.issues },
      { status: 400 },
    );
  }
  const body = parsed.data;

  // Explicit templateSlug, if provided, must be a known catalog slug.
  if (body.templateSlug !== undefined && body.templateSlug !== '') {
    if (!isWorkspaceTemplateSlug(body.templateSlug)) {
      return NextResponse.json(
        { error: 'Unknown templateSlug' },
        { status: 400 },
      );
    }
  }

  // ── 1. Resolve DB user ────────────────────────────────────────────────────
  const { data: dbUser, error: userErr } = await supabase
    .from('User')
    .select('id, name, onboard')
    .eq('clerkId', userId)
    .maybeSingle();

  if (userErr) {
    console.error('[onboarding/complete] user lookup failed', userErr);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
  if (!dbUser) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  // ── 2. Resolve Space ──────────────────────────────────────────────────────
  const { data: space, error: spaceErr } = await supabase
    .from('Space')
    .select('id, slug')
    .eq('ownerId', dbUser.id)
    .maybeSingle();

  if (spaceErr) {
    console.error('[onboarding/complete] space lookup failed', spaceErr);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
  if (!space) {
    return NextResponse.json(
      { error: 'No workspace found. Complete workspace creation first.' },
      { status: 409 },
    );
  }

  // ── 3. Seed Charles workspace (idempotent) ────────────────────────────────
  const { error: rpcErr } = await supabase.rpc('seed_charles_workspace', {
    space_id: space.id,
  });
  if (rpcErr) {
    console.warn('[onboarding/complete] seed_charles_workspace warning', rpcErr);
  }

  // ── 3b. Seed the nine workspace documents (idempotent, non-fatal) ─────────
  try {
    const { error: docSeedErr } = await supabase.rpc('seed_workspace_documents', {
      p_space_id: space.id,
    });
    if (docSeedErr) {
      console.warn('[onboarding/complete] seed_workspace_documents warning', docSeedErr);
    }
  } catch (err) {
    console.warn('[onboarding/complete] seed_workspace_documents threw', err);
  }

  // ── 4. Upsert CoreMemory slots ─────────────────────────────────────────────
  const memorySlots: { spaceId: string; slot: string; value: string | null }[] = [
    { spaceId: space.id, slot: 'company_name',        value: body.companyName?.trim() || null },
    { spaceId: space.id, slot: 'tagline',             value: body.tagline?.trim() || null },
    { spaceId: space.id, slot: 'founder_name',        value: body.founderName?.trim() || null },
    { spaceId: space.id, slot: 'product_description', value: body.whatBuilding?.trim() || null },
    { spaceId: space.id, slot: 'one_line_pitch',      value: body.oneLinePitch?.trim() || null },
    { spaceId: space.id, slot: 'target_customer',     value: body.targetCustomer?.trim() || null },
    { spaceId: space.id, slot: 'idea_stage',          value: body.ideaStage ?? null },
    { spaceId: space.id, slot: 'founder_role',        value: body.founderRole ?? null },
    { spaceId: space.id, slot: 'technical_experience',value: body.technicalExperience ?? null },
  ].filter((s) => s.value !== null);

  if (memorySlots.length > 0) {
    const { error: memErr } = await supabase
      .from('CoreMemory')
      .upsert(memorySlots, { onConflict: 'spaceId,slot' });
    if (memErr) {
      console.error('[onboarding/complete] CoreMemory upsert failed', memErr);
    }
  }

  // ── 5. Update Mission ─────────────────────────────────────────────────────
  // Note: the existing "stage" column carries the company stage gate; the
  // founder's idea stage lands in "ideaStage" instead. See migration
  // 20260606000014_charles_mission_founder_profile.sql.
  const missionUpdates: Record<string, string> = {};
  if (body.companyName?.trim()) missionUpdates.title = body.companyName.trim();
  if (body.oneLinePitch?.trim()) missionUpdates.oneLinePitch = body.oneLinePitch.trim();
  if (body.targetCustomer?.trim()) missionUpdates.targetCustomer = body.targetCustomer.trim();
  if (body.whatBuilding?.trim()) missionUpdates.description = body.whatBuilding.trim();
  if (body.ideaStage) missionUpdates.ideaStage = body.ideaStage;
  if (body.founderRole) missionUpdates.founderRole = body.founderRole;
  if (body.technicalExperience) missionUpdates.technicalExperience = body.technicalExperience;

  if (Object.keys(missionUpdates).length > 0) {
    const { error: missionErr } = await supabase
      .from('Mission')
      .update({ ...missionUpdates, updatedAt: new Date().toISOString() })
      .eq('spaceId', space.id);
    if (missionErr) {
      console.error('[onboarding/complete] Mission update failed', missionErr);
    }
  }

  // ── 6. Update User name if founderName provided ────────────────────────────
  if (body.founderName?.trim() && !dbUser.name) {
    await supabase
      .from('User')
      .update({ name: body.founderName.trim() })
      .eq('id', dbUser.id);
  }

  // ── 7. Resolve effective template slug (explicit > auto-pick > default) ───
  let appliedTemplateSlug: string;
  if (body.templateSlug) {
    appliedTemplateSlug = body.templateSlug;
  } else {
    appliedTemplateSlug = autoPickTemplateForStage(
      body.ideaStage as FounderIdeaStage | undefined,
    );
  }

  // ── 7b. Seed the welcome conversation + first task (best-effort) ──────────
  // The first thing Charles says is the trust deposit. If any of this fails
  // the user still completes onboarding — they just don't get the welcome
  // message. Logged for the operator, silent for the founder.
  try {
    const { data: existing } = await supabase
      .from('Conversation')
      .select('id')
      .eq('spaceId', space.id)
      .limit(1)
      .maybeSingle();

    if (!existing) {
      const first = buildFirstMessage({
        founderName: body.founderName?.trim() || null,
        ideaStage: body.ideaStage as FounderIdeaStage | undefined,
        companyName: body.companyName?.trim() || null,
        oneLinePitch: body.oneLinePitch?.trim() || null,
      });

      const { data: convo, error: convoErr } = await supabase
        .from('Conversation')
        .insert({ spaceId: space.id, title: first.conversationTitle })
        .select('id')
        .single();

      if (convoErr || !convo) {
        console.warn('[onboarding/complete] welcome conversation insert failed', convoErr);
      } else {
        const { error: msgErr } = await supabase.from('Message').insert({
          spaceId: space.id,
          conversationId: convo.id,
          role: 'assistant',
          content: first.messageContent,
        });
        if (msgErr) console.warn('[onboarding/complete] welcome message insert failed', msgErr);

        const { error: taskErr } = await supabase.from('Task').insert({
          spaceId: space.id,
          title: first.firstTaskTitle,
          description: '',
          status: 'open',
          priority: 'normal',
          assigneeKind: 'founder',
          assigneeDept: null,
          createdBy: 'agent',
          createdByDept: 'manager',
        });
        if (taskErr) console.warn('[onboarding/complete] welcome task insert failed', taskErr);
      }
    }
  } catch (err) {
    console.warn('[onboarding/complete] welcome seed threw', err);
  }

  // ── 8. Mark onboarding complete ───────────────────────────────────────────
  const { error: completeErr } = await supabase
    .from('User')
    .update({
      onboard: true,
      onboardingCompletedAt: new Date().toISOString(),
      onboardingCurrentStep: 10,
    })
    .eq('id', dbUser.id);

  if (completeErr) {
    console.error('[onboarding/complete] onboard flag update failed', completeErr);
    return NextResponse.json({ error: 'Failed to complete onboarding' }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    slug: space.slug,
    appliedTemplateSlug,
  });
}
