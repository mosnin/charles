'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { QUIET_LINK } from '@/lib/typography';

/**
 * Remove a teammate. Confirm via window.confirm — a dropdown plus a modal
 * for a destructive action of this weight would be ceremony. One question,
 * one answer.
 */
export function MemberActions({
  memberId,
  memberName,
}: {
  memberId: string;
  memberName: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function remove() {
    if (!window.confirm(`Remove ${memberName} from the team?`)) return;
    startTransition(async () => {
      try {
        const res = await fetch(`/api/team/members/${memberId}`, {
          method: 'DELETE',
        });
        if (!res.ok && res.status !== 204) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error || 'Could not remove member.');
        }
        toast.success(`${memberName} removed.`);
        router.refresh();
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Could not remove member.';
        toast.error(msg);
      }
    });
  }

  return (
    <button
      type="button"
      onClick={remove}
      disabled={pending}
      className={QUIET_LINK + ' disabled:opacity-50'}
    >
      {pending ? 'Removing…' : 'Remove'}
    </button>
  );
}

/**
 * Revoke a pending invite. Same quiet treatment — one click, one outcome.
 */
export function InviteActions({
  inviteId,
  email,
}: {
  inviteId: string;
  email: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function revoke() {
    if (!window.confirm(`Revoke the invite to ${email}?`)) return;
    startTransition(async () => {
      try {
        const res = await fetch(`/api/team/invites/${inviteId}`, {
          method: 'DELETE',
        });
        if (!res.ok && res.status !== 204) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error || 'Could not revoke invite.');
        }
        toast.success('Invite revoked.');
        router.refresh();
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Could not revoke invite.';
        toast.error(msg);
      }
    });
  }

  return (
    <button
      type="button"
      onClick={revoke}
      disabled={pending}
      className={QUIET_LINK + ' disabled:opacity-50'}
    >
      {pending ? 'Revoking…' : 'Revoke'}
    </button>
  );
}
