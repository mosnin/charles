import { notFound, redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import { getSpaceFromSlug } from '@/lib/space';
import { supabase } from '@/lib/supabase';
import { GeneralSettingsForm, DangerZone } from './general-settings-form';
import { ProfileSection } from './profile-section';
import { NotificationsSection } from './notifications-section';
import { LegalSettingsForm } from './legal/legal-settings-form';
import { IntegrationsSection } from './integrations-section';
import { ConnectedAppsSection } from '@/components/settings/connected-apps-section';
import { AIProfileForm } from '@/components/profile/ai-profile-form';
import type { SpaceSetting } from '@/lib/types';
import {
  H1,
  H2,
  TITLE_FONT,
  BODY,
  BODY_MUTED,
  SECTION_LABEL,
  PRIMARY_PILL,
  SECTION_RHYTHM,
  READING_MAX,
} from '@/lib/typography';

/**
 * One settings page. One scroll. Sections, not tabs. The realtor visits
 * here a few times a year — workspace name, billing pointer, who gets
 * pinged, MCP keys, danger zone. Everything else was theater.
 */
export default async function SettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  // `?integration=connected|failed&reason=...&toolkit=...` lands here after
  // the OAuth callback redirects the realtor back. Read it on the server so
  // ConnectedAppsSection can render a visible banner explaining what
  // happened — silent failure was the #1 reported bug.
  searchParams: Promise<{ integration?: string; reason?: string; toolkit?: string }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const { userId } = await auth();
  if (!userId) redirect('/login/realtor');

  const space = await getSpaceFromSlug(slug);
  if (!space) notFound();

  let settings: SpaceSetting | null = null;
  try {
    const { data, error } = await supabase
      .from('SpaceSetting')
      .select('*')
      .eq('spaceId', space.id)
      .maybeSingle();
    if (error) throw error;
    settings = (data as SpaceSetting) ?? null;
  } catch (err) {
    console.error('[settings] DB query failed', err);
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <div className="text-center space-y-3 p-8">
          <h2 className={H2}>Something went wrong</h2>
          <p className={BODY_MUTED}>
            I couldn&apos;t load your settings. Usually temporary.
          </p>
          <a href={`/s/${slug}/settings`} className={PRIMARY_PILL}>
            Try again
          </a>
        </div>
      </div>
    );
  }

  // Fetch AI profile
  const { data: aiProfile } = await supabase
    .from('AIUserProfile')
    .select('*')
    .eq('spaceId', space.id)
    .maybeSingle();

  const subStatus =
    (space as { stripeSubscriptionStatus?: string }).stripeSubscriptionStatus ?? 'inactive';
  const periodEnd = (space as { stripePeriodEnd?: string }).stripePeriodEnd;
  const isTrialing = subStatus === 'trialing';
  const isActive = subStatus === 'active';

  // ── Inline narration ladder ────────────────────────────────────────────
  // One sentence under the H1, computed from the space state. No new files.
  let narration: string;
  if (isTrialing && periodEnd) {
    const days = Math.max(
      0,
      Math.ceil((new Date(periodEnd).getTime() - Date.now()) / (1000 * 60 * 60 * 24)),
    );
    narration = `Trial ends in ${days} ${days === 1 ? 'day' : 'days'}.`;
  } else if (isActive && periodEnd) {
    const days = Math.max(
      0,
      Math.ceil((new Date(periodEnd).getTime() - Date.now()) / (1000 * 60 * 60 * 24)),
    );
    narration = `Subscription active. Next charge in ${days} ${days === 1 ? 'day' : 'days'}.`;
  } else if (subStatus === 'inactive') {
    narration = 'No active subscription yet.';
  } else {
    narration = 'Workspace settings.';
  }

  return (
    <div className={`${SECTION_RHYTHM} ${READING_MAX}`}>
      {/* Page header */}
      <header className="space-y-1.5">
        <p className={BODY_MUTED}>Settings.</p>
        <h1 className={H1} style={TITLE_FONT}>
          Settings
        </h1>
        <p className={BODY_MUTED}>
          {narration}
          {(isTrialing || isActive || subStatus === 'inactive') && (
            <>
              {' '}
              <a
                href={`/s/${slug}/billing`}
                className="underline underline-offset-2 text-foreground hover:text-foreground/80"
              >
                {subStatus === 'inactive' ? 'Start trial' : 'Manage billing'}
              </a>
            </>
          )}
        </p>
      </header>

      {/* WORKSPACE */}
      <section className="space-y-5 pt-4">
        <p className={SECTION_LABEL}>Workspace</p>
        <GeneralSettingsForm space={space} settings={settings} />
      </section>

      {/* DEPARTMENTS — per-department autonomy levels */}
      <section
        id="departments"
        className="space-y-5 pt-10 border-t border-border/60 scroll-mt-24"
      >
        <p className={SECTION_LABEL}>Departments</p>
        <div className="flex items-center justify-between gap-6">
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">Autonomy levels</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Decide how much each part of Charles is allowed to do without you.
            </p>
          </div>
          <a
            href={`/s/${slug}/settings/departments`}
            className={PRIMARY_PILL}
          >
            Open
          </a>
        </div>
      </section>

      {/* PROFILE — identity, photo, bio, social */}
      <section
        id="profile"
        className="space-y-5 pt-10 border-t border-border/60 scroll-mt-24"
      >
        <p className={SECTION_LABEL}>Profile</p>
        <ProfileSection slug={space.slug} />
      </section>

      {/* ── AI Personalization ──────────────────────────────────────── */}
      <section id="ai-profile" className="space-y-5 pt-10 border-t border-border/60 scroll-mt-24">
        <div className="mb-6">
          <h2 className="text-base font-semibold">AI Personalization</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Tell Chippi about you so responses feel tailored, not generic.
          </p>
        </div>
        <AIProfileForm slug={slug} spaceId={space.id} />
      </section>

      {/* NOTIFICATIONS */}
      <section
        id="notifications"
        className="space-y-5 pt-10 border-t border-border/60 scroll-mt-24"
      >
        <p className={SECTION_LABEL}>Notifications</p>
        <NotificationsSection slug={space.slug} />
      </section>

      {/* LEGAL */}
      <section
        id="legal"
        className="space-y-5 pt-10 border-t border-border/60 scroll-mt-24"
      >
        <p className={SECTION_LABEL}>Legal</p>
        <LegalSettingsForm
          slug={space.slug}
          privacyPolicyUrl={settings?.privacyPolicyUrl ?? ''}
        />
      </section>

      {/* CONNECTED APPS — Composio integrations */}
      <section
        id="integrations"
        className="space-y-5 pt-10 border-t border-border/60 scroll-mt-24"
      >
        <p className={SECTION_LABEL}>Connected apps</p>
        <ConnectedAppsSection
          callbackResult={
            sp.integration === 'connected' || sp.integration === 'failed'
              ? {
                  ok: sp.integration === 'connected',
                  reason: sp.reason ?? null,
                  toolkit: sp.toolkit ?? null,
                }
              : null
          }
        />
      </section>

      {/* MCP KEYS + MESSAGE TEMPLATES */}
      <section
        id="api-keys"
        className="space-y-5 pt-10 border-t border-border/60 scroll-mt-24"
      >
        <p className={SECTION_LABEL}>API keys &amp; templates</p>
        <IntegrationsSection slug={space.slug} />
      </section>

      {/* DANGER ZONE */}
      <section className="space-y-5 pt-10 border-t border-border/60">
        <p className={SECTION_LABEL}>Danger zone</p>
        <DangerZone space={space} />
      </section>
    </div>
  );
}
