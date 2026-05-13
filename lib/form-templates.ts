// TODO: dead after realtor delete — remove on next sweep
/**
 * Brokerage form template management.
 *
 * Handles pushing a brokerage-level form config to member realtors,
 * detaching members from the brokerage template, and reporting member
 * form status for the broker dashboard.
 */

import { supabase } from '@/lib/supabase';
import type { IntakeFormConfig, FormConfigSource } from '@/lib/types';

// ── Push brokerage form to all member realtors ────────────────────────────────

/**
 * Sets the form config on all member realtors' SpaceSettings where
 * `formConfigSource !== 'custom'`.  Updates their `formConfig` and
 * sets `formConfigSource` to `'brokerage'`.
 */
export async function pushFormToMembers(
  brokerageId: string,
  formConfig: IntakeFormConfig,
): Promise<{ updated: number; skipped: number }> {
  // 1. Get all spaces belonging to this brokerage
  const { data: spaces, error: spaceErr } = await supabase
    .from('Space')
    .select('id')
    .eq('brokerageId', brokerageId);

  if (spaceErr) {
    console.error('[form-templates] Failed to fetch brokerage spaces', spaceErr);
    throw spaceErr;
  }

  if (!spaces || spaces.length === 0) {
    return { updated: 0, skipped: 0 };
  }

  const spaceIds = spaces.map((s: { id: string }) => s.id);

  // 2. Fetch each space's current formConfigSource so we can skip 'custom'
  const { data: settings, error: settingsErr } = await supabase
    .from('SpaceSetting')
    .select('id, spaceId, formConfigSource')
    .in('spaceId', spaceIds);

  if (settingsErr) {
    console.error('[form-templates] Failed to fetch SpaceSettings', settingsErr);
    throw settingsErr;
  }

  let updated = 0;
  let skipped = 0;

  const promises = (settings ?? []).map(async (setting: { id: string; spaceId: string; formConfigSource: FormConfigSource | null }) => {
    if (setting.formConfigSource === 'custom') {
      skipped++;
      return;
    }
    const { error } = await supabase
      .from('SpaceSetting')
      .update({
        formConfig: formConfig as any,
        formConfigSource: 'brokerage',
      })
      .eq('id', setting.id);

    if (error) {
      console.error(`[form-templates] Failed to update SpaceSetting ${setting.id}`, error);
      skipped++;
    } else {
      updated++;
    }
  });

  await Promise.all(promises);

  // 3. Also persist on the Brokerage row itself
  await supabase
    .from('Brokerage')
    .update({ brokerageFormConfig: formConfig as any })
    .eq('id', brokerageId);

  return { updated, skipped };
}

// ── Detach a member from brokerage template ───────────────────────────────────

/**
 * Allows a realtor to "detach" from the brokerage template and
 * customise their own form.  Copies the current form config as the
 * starting point and sets `formConfigSource` to `'custom'`.
 */
export async function detachFromBrokerageForm(spaceId: string): Promise<void> {
  // Read current config (may come from brokerage)
  const { data: setting, error } = await supabase
    .from('SpaceSetting')
    .select('id, formConfig, formConfigSource')
    .eq('spaceId', spaceId)
    .maybeSingle();

  if (error) {
    console.error('[form-templates] Failed to read SpaceSetting', error);
    throw error;
  }
  if (!setting) {
    throw new Error(`No SpaceSetting found for space ${spaceId}`);
  }

  if (setting.formConfigSource === 'custom') {
    // Already detached — nothing to do
    return;
  }

  // If there's a brokerage config in place, keep it as the starting point
  const { error: updateErr } = await supabase
    .from('SpaceSetting')
    .update({ formConfigSource: 'custom' })
    .eq('id', setting.id);

  if (updateErr) {
    console.error('[form-templates] Failed to detach', updateErr);
    throw updateErr;
  }
}

// ── Member form status report ─────────────────────────────────────────────────

export interface MemberFormStatus {
  userId: string;
  userName: string | null;
  userEmail: string;
  spaceId: string;
  spaceName: string;
  status: 'brokerage' | 'custom' | 'legacy';
}

/**
 * Returns a list of members with their form status for the broker
 * dashboard.
 *
 *   - `brokerage` — using the brokerage template
 *   - `custom` — customised their own form
 *   - `legacy` — no dynamic form config at all
 */
export async function getMemberFormStatus(
  brokerageId: string,
): Promise<MemberFormStatus[]> {
  // Get memberships
  const { data: memberships, error: memErr } = await supabase
    .from('BrokerageMembership')
    .select('userId')
    .eq('brokerageId', brokerageId);

  if (memErr) {
    console.error('[form-templates] Failed to fetch memberships', memErr);
    throw memErr;
  }
  if (!memberships || memberships.length === 0) return [];

  const userIds = memberships.map((m: { userId: string }) => m.userId);

  // Fetch user info
  const { data: users } = await supabase
    .from('User')
    .select('id, name, email')
    .in('id', userIds);

  const userMap = new Map(
    (users ?? []).map((u: { id: string; name: string | null; email: string }) => [u.id, u]),
  );

  // Fetch spaces for these users that belong to this brokerage
  const { data: spaces } = await supabase
    .from('Space')
    .select('id, name, ownerId')
    .eq('brokerageId', brokerageId)
    .in('ownerId', userIds);

  if (!spaces || spaces.length === 0) return [];

  const spaceIds = spaces.map((s: { id: string }) => s.id);

  // Fetch SpaceSettings
  const { data: settings } = await supabase
    .from('SpaceSetting')
    .select('spaceId, formConfig, formConfigSource')
    .in('spaceId', spaceIds);

  const settingMap = new Map(
    (settings ?? []).map((s: { spaceId: string; formConfig: any; formConfigSource: FormConfigSource | null }) => [s.spaceId, s]),
  );

  return spaces.map((space: { id: string; name: string; ownerId: string }) => {
    const user = userMap.get(space.ownerId);
    const setting = settingMap.get(space.id);

    let status: 'brokerage' | 'custom' | 'legacy' = 'legacy';
    if (setting?.formConfigSource === 'custom') {
      status = 'custom';
    } else if (setting?.formConfigSource === 'brokerage') {
      status = 'brokerage';
    } else if (setting?.formConfig) {
      // Has a form config but no explicit source — treat as custom
      status = 'custom';
    }

    return {
      userId: space.ownerId,
      userName: user?.name ?? null,
      userEmail: user?.email ?? '',
      spaceId: space.id,
      spaceName: space.name,
      status,
    };
  });
}
