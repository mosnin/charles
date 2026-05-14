import { redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import { supabase } from '@/lib/supabase';
import {
  H1,
  TITLE_FONT,
  BODY,
  BODY_MUTED,
  PAGE_RHYTHM,
  READING_MAX,
} from '@/lib/typography';
import { AcceptInviteButton } from './accept-button';

/**
 * Public landing page for a team invite link. The invitee clicks the URL
 * in their email, lands here, sees the team name, and accepts. If they're
 * not signed in, Clerk's middleware sends them through sign-in first and
 * brings them back here.
 *
 * This page does not call the accept route directly — it hands the click
 * to a small client component so the founder sees the "Joining…" state.
 */
export default async function AcceptInvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const { userId } = await auth();

  // Not signed in — bounce through sign-in and come back. We use the
  // existing realtor login route so all auth lands in one place.
  if (!userId) {
    redirect(`/sign-in?redirect_url=${encodeURIComponent(`/team/accept/${token}`)}`);
  }

  const { data: invite } = await supabase
    .from('TeamInvite')
    .select('id, teamId, email, role, expiresAt, acceptedAt')
    .eq('token', token)
    .maybeSingle();

  return (
    <main className="min-h-screen flex items-start justify-center px-6 pt-24 pb-16">
      <div className={`${PAGE_RHYTHM} ${READING_MAX} w-full`}>
        {await renderInviteBody(invite, token)}
      </div>
    </main>
  );
}

async function renderInviteBody(
  invite: unknown,
  token: string,
): Promise<React.ReactNode> {
  if (!invite) {
    return (
      <header className="space-y-3 text-center">
        <h1 className={H1} style={TITLE_FONT}>
          This invite link is invalid.
        </h1>
        <p className={BODY_MUTED}>
          Ask whoever invited you to send a new one.
        </p>
      </header>
    );
  }

  const row = invite as {
    id: string;
    teamId: string;
    email: string;
    role: 'admin' | 'member';
    expiresAt: string;
    acceptedAt: string | null;
  };

  if (row.acceptedAt) {
    return (
      <header className="space-y-3 text-center">
        <h1 className={H1} style={TITLE_FONT}>
          This invite has been used.
        </h1>
        <p className={BODY_MUTED}>
          If that wasn&apos;t you, ask for a new invite.
        </p>
      </header>
    );
  }

  if (new Date(row.expiresAt).getTime() < Date.now()) {
    return (
      <header className="space-y-3 text-center">
        <h1 className={H1} style={TITLE_FONT}>
          This invite has expired.
        </h1>
        <p className={BODY_MUTED}>
          Invites last seven days. Ask for a new one.
        </p>
      </header>
    );
  }

  // Look up the team + the space slug so we can redirect after accept.
  const { data: teamRow } = await supabase
    .from('Team')
    .select('id, name, spaceId')
    .eq('id', row.teamId)
    .maybeSingle();
  const team = teamRow as { id: string; name: string; spaceId: string } | null;

  const { data: spaceRow } = team
    ? await supabase.from('Space').select('slug').eq('id', team.spaceId).maybeSingle()
    : { data: null };
  const slug = (spaceRow as { slug?: string } | null)?.slug ?? null;

  const roleLabel = row.role === 'admin' ? 'Admin' : 'Member';

  return (
    <>
      <header className="space-y-3 text-center">
        <p className={BODY_MUTED}>You&apos;ve been invited.</p>
        <h1 className={H1} style={TITLE_FONT}>
          Join {team?.name ?? 'this team'}
        </h1>
        <p className={BODY_MUTED}>
          You&apos;ll join as <span className="text-foreground">{roleLabel}</span>.
        </p>
      </header>
      <div className="flex flex-col items-center gap-3">
        <AcceptInviteButton token={token} redirectSlug={slug} />
        <p className={`${BODY} text-xs text-muted-foreground`}>
          Signed in as the wrong person? Sign out and sign back in with{' '}
          <span className="text-foreground">{row.email}</span>.
        </p>
      </div>
    </>
  );
}
