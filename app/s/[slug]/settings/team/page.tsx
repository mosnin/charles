import { notFound, redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import { getSpaceFromSlug } from '@/lib/space';
import { getMemberRole, type Role } from '@/lib/team/permissions';
import { supabase } from '@/lib/supabase';
import { InviteForm } from './invite-form';
import { MemberActions, InviteActions } from './member-actions';
import {
  H1,
  TITLE_FONT,
  BODY_MUTED,
  PAGE_RHYTHM,
  READING_MAX,
  SECTION_LABEL,
} from '@/lib/typography';

/**
 * Team settings. One screen. Members on top, pending invites underneath,
 * a single Invite affordance at the bottom. No tabs, no filter chips.
 * A founding team is small; if you have to filter, the product is wrong.
 */
export default async function TeamSettingsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { userId } = await auth();
  if (!userId) redirect('/login/realtor');

  const space = await getSpaceFromSlug(slug);
  if (!space) notFound();

  // Caller's own role — drives whether the invite form and remove buttons render.
  const callerRole = await getMemberRole(space.id, userId);

  // Resolve the Team row (may be null for older spaces; render an empty state).
  const { data: teamRow } = await supabase
    .from('Team')
    .select('id, name')
    .eq('spaceId', space.id)
    .maybeSingle();
  const team = teamRow as { id: string; name: string } | null;

  const members: Array<{
    id: string;
    userId: string;
    role: Role;
    joinedAt: string;
    displayName: string;
    email: string | null;
  }> = [];
  const invites: Array<{
    id: string;
    email: string;
    role: 'admin' | 'member';
    createdAt: string;
    expiresAt: string;
  }> = [];

  if (team) {
    const { data: membershipRows } = await supabase
      .from('TeamMembership')
      .select('id, userId, role, joinedAt')
      .eq('teamId', team.id)
      .order('joinedAt', { ascending: true });

    const memberships = (membershipRows ?? []) as Array<{
      id: string;
      userId: string;
      role: Role;
      joinedAt: string;
    }>;

    // Resolve display names from the User table where we can. Falls back to
    // a truncated id label so nothing renders empty.
    const clerkIds = memberships.map((m) => m.userId);
    let users: Array<{ clerkId: string; name: string | null; email: string | null }> = [];
    if (clerkIds.length > 0) {
      const { data: userRows } = await supabase
        .from('User')
        .select('clerkId, name, email')
        .in('clerkId', clerkIds);
      users = (userRows ?? []) as typeof users;
    }
    const userByClerkId = new Map(users.map((u) => [u.clerkId, u]));

    for (const m of memberships) {
      const u = userByClerkId.get(m.userId);
      members.push({
        id: m.id,
        userId: m.userId,
        role: m.role,
        joinedAt: m.joinedAt,
        displayName: u?.name?.trim() || u?.email || 'Teammate',
        email: u?.email ?? null,
      });
    }

    const { data: inviteRows } = await supabase
      .from('TeamInvite')
      .select('id, email, role, createdAt, expiresAt, acceptedAt')
      .eq('teamId', team.id)
      .is('acceptedAt', null)
      .order('createdAt', { ascending: false });

    for (const inv of (inviteRows ?? []) as Array<{
      id: string;
      email: string;
      role: 'admin' | 'member';
      createdAt: string;
      expiresAt: string;
    }>) {
      invites.push({
        id: inv.id,
        email: inv.email,
        role: inv.role,
        createdAt: inv.createdAt,
        expiresAt: inv.expiresAt,
      });
    }
  }

  const canManage = callerRole === 'owner' || callerRole === 'admin';

  return (
    <div className={`${PAGE_RHYTHM} ${READING_MAX}`}>
      <header className="space-y-1.5">
        <p className={BODY_MUTED}>Settings.</p>
        <h1 className={H1} style={TITLE_FONT}>
          Team
        </h1>
        <p className={BODY_MUTED}>
          Invite teammates and decide what they can do.
        </p>
      </header>

      {/* Members */}
      <section className="space-y-4">
        <p className={SECTION_LABEL}>Members</p>
        {members.length === 0 ? (
          <p className={BODY_MUTED}>
            It&apos;s just you in here. Send an invite below to bring someone in.
          </p>
        ) : (
          <ul className="divide-y divide-border/60 border-y border-border/60">
            {members.map((m) => (
              <li
                key={m.id}
                className="flex items-center justify-between gap-6 py-4"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">
                    {m.displayName}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">
                    {m.email ?? '—'}
                  </p>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <span className="text-xs uppercase tracking-wider text-muted-foreground">
                    {roleLabel(m.role)}
                  </span>
                  {canManage && m.role !== 'owner' && m.userId !== userId ? (
                    <MemberActions memberId={m.id} memberName={m.displayName} />
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Pending invites */}
      {invites.length > 0 ? (
        <section className="space-y-4">
          <p className={SECTION_LABEL}>Pending invites</p>
          <ul className="divide-y divide-border/60 border-y border-border/60">
            {invites.map((inv) => (
              <li
                key={inv.id}
                className="flex items-center justify-between gap-6 py-4"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">
                    {inv.email}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Sent {formatRelative(inv.createdAt)}
                  </p>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <span className="text-xs uppercase tracking-wider text-muted-foreground">
                    {roleLabel(inv.role)}
                  </span>
                  {canManage ? (
                    <InviteActions inviteId={inv.id} email={inv.email} />
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Invite form */}
      {canManage ? (
        <section className="space-y-4">
          <p className={SECTION_LABEL}>Invite a teammate</p>
          <InviteForm />
        </section>
      ) : null}
    </div>
  );
}

function roleLabel(role: Role | 'admin' | 'member'): string {
  if (role === 'owner') return 'Owner';
  if (role === 'admin') return 'Admin';
  return 'Member';
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const ms = Date.now() - then;
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}
