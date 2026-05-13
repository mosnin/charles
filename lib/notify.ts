/**
 * Unified notification dispatcher.
 *
 * Sends email notifications to space owners based on their notification
 * preferences in SpaceSetting.
 *
 * Preferences:
 *   - notifications (master email toggle)
 *   - notifyNewDeals (per-event: new deals)
 *
 * All functions are non-blocking and never throw.
 */

import { supabase } from '@/lib/supabase';
import { sendNewDealNotification } from '@/lib/email';
import { logger } from '@/lib/logger';

interface SpaceOwnerInfo {
  ownerEmail: string;
  spaceName: string;
  spaceSlug: string;
  // Channel toggles
  emailEnabled: boolean;
  // Per-event toggles
  notifyNewLeads: boolean;
  notifyNewDeals: boolean;
}

/**
 * Fetch the space owner's contact info and notification preferences.
 * Returns null if space/owner not found.
 */
async function getSpaceOwnerInfo(spaceId: string): Promise<SpaceOwnerInfo | null> {
  try {
    const [{ data: space }, { data: settings }] = await Promise.all([
      supabase.from('Space').select('ownerId, name, slug').eq('id', spaceId).maybeSingle(),
      supabase
        .from('SpaceSetting')
        .select('notifications, notifyNewLeads, notifyNewDeals')
        .eq('spaceId', spaceId)
        .maybeSingle(),
    ]);

    if (!space) return null;

    const { data: owner } = await supabase.from('User').select('email').eq('id', space.ownerId).maybeSingle();
    if (!owner?.email) return null;

    return {
      ownerEmail: owner.email,
      spaceName: space.name,
      spaceSlug: space.slug,
      emailEnabled: settings?.notifications ?? true,
      notifyNewLeads: settings?.notifyNewLeads ?? true,
      notifyNewDeals: settings?.notifyNewDeals ?? true,
    };
  } catch (err) {
    logger.error('[notify] failed to fetch space owner info', { spaceId }, err);
    return null;
  }
}

// ── New Deal Created ─────────────────────────────────────────────────────

export interface NotifyNewDealParams {
  spaceId: string;
  dealTitle: string;
  dealValue?: number | null;
  dealAddress?: string | null;
  dealPriority?: string | null;
  contactNames?: string[];
}

/**
 * Notify space owner about a new deal via email.
 * Respects both the channel toggle AND the notifyNewDeals event toggle.
 */
export async function notifyNewDeal(params: NotifyNewDealParams): Promise<void> {
  const info = await getSpaceOwnerInfo(params.spaceId);
  if (!info || !info.notifyNewDeals || !info.emailEnabled) return;

  try {
    await sendNewDealNotification({
      toEmail: info.ownerEmail,
      spaceName: info.spaceName,
      spaceSlug: info.spaceSlug,
      dealTitle: params.dealTitle,
      dealValue: params.dealValue,
      dealAddress: params.dealAddress,
      dealPriority: params.dealPriority,
      contactNames: params.contactNames,
    });
  } catch (err) {
    logger.error('[notify] deal email failed', { spaceId: params.spaceId }, err);
  }
}

// ── New Contact (manually added) ─────────────────────────────────────────

export interface NotifyNewContactParams {
  spaceId: string;
  contactName: string;
  contactPhone?: string | null;
  contactEmail?: string | null;
  tags?: string[];
}

/**
 * Notify space owner about a manually added contact (new lead).
 * No-op for now — SMS path was removed with the Charles cleanup; the
 * email path went with it. Kept as a stub so ai-tools/add-person can
 * still call it without conditional logic.
 */
export async function notifyNewContact(_params: NotifyNewContactParams): Promise<void> {
  // intentionally empty — see file header
}
