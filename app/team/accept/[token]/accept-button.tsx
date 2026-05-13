'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { PRIMARY_PILL } from '@/lib/typography';

/**
 * Single-button accept. On success we redirect to the workspace; on
 * failure we surface the server's sentence verbatim.
 */
export function AcceptInviteButton({
  token,
  redirectSlug,
}: {
  token: string;
  redirectSlug: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(false);

  function accept() {
    startTransition(async () => {
      try {
        const res = await fetch(`/api/team/accept/${encodeURIComponent(token)}`, {
          method: 'POST',
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error || 'Could not accept the invite.');
        }
        setDone(true);
        toast.success('Welcome to the team.');
        if (redirectSlug) {
          router.push(`/s/${redirectSlug}`);
        } else {
          router.push('/');
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Could not accept the invite.';
        toast.error(msg);
      }
    });
  }

  return (
    <button
      type="button"
      onClick={accept}
      disabled={pending || done}
      className={PRIMARY_PILL + ' disabled:opacity-50 disabled:cursor-not-allowed'}
    >
      {done ? 'Joined.' : pending ? 'Joining…' : 'Accept invite'}
    </button>
  );
}
