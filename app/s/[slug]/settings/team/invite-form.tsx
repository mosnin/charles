'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { PRIMARY_PILL } from '@/lib/typography';

/**
 * Single-row invite form: email + role + send. Optimistic on success
 * (refresh the page so the new pending invite appears immediately).
 * No fancy modal — a one-line form is faster than a wizard.
 */
export function InviteForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'admin' | 'member'>('member');
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) {
      toast.error('Enter an email address.');
      return;
    }

    startTransition(async () => {
      try {
        const res = await fetch('/api/team/invite', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: trimmed, role }),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error || 'Could not send the invite.');
        }
        toast.success(`Invite sent to ${trimmed}.`);
        setEmail('');
        setRole('member');
        router.refresh();
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Could not send the invite.';
        toast.error(msg);
      }
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="teammate@example.com"
        autoComplete="off"
        required
        className="flex-1 min-w-[14rem] h-9 rounded-full border border-border bg-background px-4 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/30"
      />
      <select
        value={role}
        onChange={(e) => setRole(e.target.value as 'admin' | 'member')}
        className="h-9 rounded-full border border-border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/30"
        aria-label="Role"
      >
        <option value="member">Member</option>
        <option value="admin">Admin</option>
      </select>
      <button
        type="submit"
        disabled={pending}
        className={PRIMARY_PILL + ' disabled:opacity-50 disabled:cursor-not-allowed'}
      >
        {pending ? 'Sending…' : 'Send invite'}
      </button>
    </form>
  );
}
