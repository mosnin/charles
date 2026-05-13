/**
 * Charles workspace layout.
 *
 * One top bar. No sidebar. ⌘K opens everything. Auth (Clerk) and the
 * subscription gate stay; everything else is a launcher away.
 */

import { notFound, redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { auth } from '@clerk/nextjs/server';
import { getSpaceFromSlug } from '@/lib/space';
import { supabase } from '@/lib/supabase';
import { ensureOnboardingBackfill } from '@/lib/onboarding';
import { PaywallBanner } from '@/components/billing/paywall-banner';
import { PlatformBanner } from '@/components/platform-banner';
import { checkPaywall } from '@/lib/billing/paywall';
import { WorkspaceShell } from '@/components/workspace-shell';

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { userId } = await auth();

  if (!userId) {
    redirect('/sign-in');
  }

  // Resolve the founder record + their space in one server pass.
  let dbUser:
    | {
        id: string;
        onboard: boolean;
        isPlatformAdmin: boolean;
        space: { id: string } | null;
      }
    | null
    | undefined;

  try {
    const { data: row, error } = await supabase
      .from('User')
      .select('id, onboard, platformRole')
      .eq('clerkId', userId)
      .maybeSingle();
    if (error) throw error;
    if (row) {
      const { data: spaceRow } = await supabase
        .from('Space')
        .select('id')
        .eq('ownerId', row.id)
        .maybeSingle();
      dbUser = {
        id: row.id as string,
        onboard: row.onboard as boolean,
        isPlatformAdmin: row.platformRole === 'admin',
        space: spaceRow ? { id: spaceRow.id as string } : null,
      };
    } else {
      dbUser = null;
    }
  } catch (err) {
    console.error('[layout] DB query failed', { clerkId: userId, slug, error: err });
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center space-y-4 p-8">
          <h1 className="text-xl font-semibold">Something went wrong.</h1>
          <p className="text-sm text-muted-foreground">
            We could not load your workspace. This is usually temporary.
          </p>
          <a
            href={`/s/${slug}`}
            className="inline-block px-4 py-2 text-sm font-medium rounded-md bg-foreground text-background hover:opacity-90"
          >
            Try again
          </a>
        </div>
      </div>
    );
  }

  if (!dbUser) {
    redirect('/onboarding');
  }

  try {
    await ensureOnboardingBackfill(dbUser);
  } catch (err) {
    console.error('[layout] backfill failed (non-blocking)', { clerkId: userId, slug, error: err });
  }

  let space;
  try {
    space = await getSpaceFromSlug(slug);
  } catch (err) {
    console.error('[layout] getSpaceFromSlug failed', { slug, error: err });
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center space-y-4 p-8">
          <h1 className="text-xl font-semibold">Something went wrong.</h1>
          <p className="text-sm text-muted-foreground">
            We could not load your workspace. This is usually temporary.
          </p>
        </div>
      </div>
    );
  }
  if (!space) notFound();

  // The founder must own this workspace.
  if (!dbUser.space || dbUser.space.id !== space.id) notFound();

  // ── Subscription gate ────────────────────────────────────────────────
  // Past-due / canceled: surface the quiet banner and push the founder
  // into billing to resolve it. Active / trialing / no-sub flow through.
  const headersList = await headers();
  const currentPath =
    headersList.get('x-pathname') ||
    headersList.get('x-invoke-path') ||
    headersList.get('x-matched-path') ||
    headersList.get('next-url') ||
    '';
  const isBillingPath = currentPath.includes('/settings/billing');

  let paywall: { allowed: boolean; reason: 'past_due' | 'canceled' | null } = {
    allowed: true,
    reason: null,
  };
  try {
    const res = await checkPaywall(space.id);
    paywall = {
      allowed: res.allowed,
      reason: res.reason === 'past_due' || res.reason === 'canceled' ? res.reason : null,
    };
  } catch {
    // Banner is decoration; if the check fails, behave as if all is well.
  }

  if (!paywall.allowed && !dbUser.isPlatformAdmin && !isBillingPath) {
    redirect(`/s/${slug}/settings/billing`);
  }

  // Workspace display name — prefer the mission title when it's set.
  let workspaceName = space.name;
  try {
    const { data: mission } = await supabase
      .from('Mission')
      .select('title')
      .eq('spaceId', space.id)
      .maybeSingle();
    if (mission?.title && typeof mission.title === 'string' && mission.title.length > 0) {
      workspaceName = mission.title;
    }
  } catch {
    // Fall back to space.name.
  }

  return (
    <div className="app-theme flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <PlatformBanner />
      {!paywall.allowed && paywall.reason && (
        <PaywallBanner slug={slug} reason={paywall.reason} />
      )}
      <WorkspaceShell slug={slug} workspaceName={workspaceName}>
        {children}
      </WorkspaceShell>
    </div>
  );
}
