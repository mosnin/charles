/**
 * POST /api/onboarding/complete
 *
 * Finalises Charles onboarding:
 *   1. Authenticates user via Clerk.
 *   2. Resolves the user's Space.
 *   3. Calls seed_charles_workspace(spaceId) via Supabase RPC.
 *   4. Upserts CoreMemory slots with the collected wizard data.
 *   5. Updates the Mission title and oneLinePitch.
 *   6. Marks the user as onboarded (onboard = true).
 *   7. Returns { success: true, slug }.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { supabase } from '@/lib/supabase';

interface CompleteBody {
  companyName?: string;
  tagline?: string;
  founderName?: string;
  whatBuilding?: string;
  oneLinePitch?: string;
  targetCustomer?: string;
  githubConnected?: boolean;
  githubSkipped?: boolean;
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { userId } = auth;

  let body: CompleteBody;
  try {
    body = (await req.json()) as CompleteBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
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
    // Non-fatal: tables may already be seeded. Log and continue.
    console.warn('[onboarding/complete] seed_charles_workspace warning', rpcErr);
  }

  // ── 4. Upsert CoreMemory slots ─────────────────────────────────────────────
  const memorySlots: { spaceId: string; slot: string; value: string | null }[] = [
    { spaceId: space.id, slot: 'company_name',        value: body.companyName?.trim() || null },
    { spaceId: space.id, slot: 'tagline',             value: body.tagline?.trim() || null },
    { spaceId: space.id, slot: 'founder_name',        value: body.founderName?.trim() || null },
    { spaceId: space.id, slot: 'product_description', value: body.whatBuilding?.trim() || null },
    { spaceId: space.id, slot: 'one_line_pitch',      value: body.oneLinePitch?.trim() || null },
    { spaceId: space.id, slot: 'target_customer',     value: body.targetCustomer?.trim() || null },
  ].filter((s) => s.value !== null);

  if (memorySlots.length > 0) {
    const { error: memErr } = await supabase
      .from('CoreMemory')
      .upsert(memorySlots, { onConflict: 'spaceId,slot' });
    if (memErr) {
      console.error('[onboarding/complete] CoreMemory upsert failed', memErr);
      // Non-fatal — continue
    }
  }

  // ── 5. Update Mission ─────────────────────────────────────────────────────
  const missionUpdates: Record<string, string> = {};
  if (body.companyName?.trim()) missionUpdates.title = body.companyName.trim();
  if (body.oneLinePitch?.trim()) missionUpdates.oneLinePitch = body.oneLinePitch.trim();
  if (body.targetCustomer?.trim()) missionUpdates.targetCustomer = body.targetCustomer.trim();
  if (body.whatBuilding?.trim()) missionUpdates.description = body.whatBuilding.trim();

  if (Object.keys(missionUpdates).length > 0) {
    const { error: missionErr } = await supabase
      .from('Mission')
      .update({ ...missionUpdates, updatedAt: new Date().toISOString() })
      .eq('spaceId', space.id);
    if (missionErr) {
      console.error('[onboarding/complete] Mission update failed', missionErr);
      // Non-fatal
    }
  }

  // ── 6. Update User name if founderName provided ────────────────────────────
  if (body.founderName?.trim() && !dbUser.name) {
    await supabase
      .from('User')
      .update({ name: body.founderName.trim() })
      .eq('id', dbUser.id);
  }

  // ── 7. Mark onboarding complete ───────────────────────────────────────────
  const { error: completeErr } = await supabase
    .from('User')
    .update({
      onboard: true,
      onboardingCompletedAt: new Date().toISOString(),
      onboardingCurrentStep: 7,
    })
    .eq('id', dbUser.id);

  if (completeErr) {
    console.error('[onboarding/complete] onboard flag update failed', completeErr);
    return NextResponse.json({ error: 'Failed to complete onboarding' }, { status: 500 });
  }

  return NextResponse.json({ success: true, slug: space.slug });
}
