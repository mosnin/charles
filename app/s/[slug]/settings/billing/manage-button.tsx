'use client';

import { useState } from 'react';
import { BODY, GHOST_PILL } from '@/lib/typography';

export function ManageBillingButton({ disabled }: { disabled?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function open() {
    if (busy || disabled) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/billing/portal', { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body?.url) {
        setError(body?.error ?? 'Could not open the billing portal.');
        setBusy(false);
        return;
      }
      window.location.href = body.url;
    } catch {
      setError('Could not open the billing portal.');
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <button onClick={open} disabled={busy || disabled} className={GHOST_PILL}>
        {busy ? 'Opening Stripe…' : 'Manage billing'}
      </button>
      {error && <p className={`${BODY} text-destructive`}>{error}</p>}
    </div>
  );
}
