'use client';

/**
 * Client controls for the MCP page — create a key (raw value shown once,
 * never again) and revoke a key (one tap, no modal-chrome). The page is
 * the source of truth; this file just talks to /api/mcp-keys and rerenders.
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

type Props =
  | { mode: 'create' }
  | { mode: 'revoke'; id: string; name: string };

export function McpActions(props: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [raw, setRaw] = useState<string | null>(null);

  if (props.mode === 'create') {
    async function create() {
      try {
        const res = await fetch('/api/mcp-keys', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'External client' }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          key?: string;
          error?: string;
        };
        if (!res.ok || !data.key) {
          throw new Error(data.error || 'Could not create key.');
        }
        setRaw(data.key);
        startTransition(() => router.refresh());
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Could not create key.';
        toast.error(msg);
      }
    }
    return (
      <>
        <button
          type="button"
          onClick={create}
          disabled={pending}
          className="inline-flex h-8 items-center rounded-full bg-foreground px-4 text-xs font-medium text-background hover:bg-foreground/90 disabled:opacity-50"
        >
          New key
        </button>
        {raw ? <RawKeyDialog rawKey={raw} onClose={() => setRaw(null)} /> : null}
      </>
    );
  }

  // Narrow the discriminated union into locals BEFORE defining `revoke`.
  // TS doesn't propagate narrowing through nested function closures.
  const { id, name } = props;

  async function revoke() {
    const ok = window.confirm(
      `Revoke "${name}"? Any client using this key will stop working.`,
    );
    if (!ok) return;
    try {
      const res = await fetch('/api/mcp-keys', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error || 'Could not revoke.');
      toast.success(`Revoked ${name}.`);
      startTransition(() => router.refresh());
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not revoke.';
      toast.error(msg);
    }
  }

  return (
    <button
      type="button"
      onClick={revoke}
      disabled={pending}
      className="inline-flex h-8 items-center rounded-full border border-border px-3 text-xs font-medium text-muted-foreground hover:text-foreground disabled:opacity-50"
    >
      Revoke
    </button>
  );
}

function RawKeyDialog({ rawKey, onClose }: { rawKey: string; onClose: () => void }) {
  async function copy() {
    try {
      await navigator.clipboard.writeText(rawKey);
      toast.success('Copied.');
    } catch {
      toast.error('Copy failed. Select and copy manually.');
    }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/30 p-4">
      <div className="w-full max-w-md rounded-2xl bg-background p-6 shadow-2xl space-y-4">
        <div className="space-y-1">
          <p className="text-base font-semibold text-foreground">Your new key</p>
          <p className="text-xs text-muted-foreground">
            Copy it now. We won&apos;t show it again.
          </p>
        </div>
        <div className="rounded-lg border border-border bg-muted/30 px-3 py-3 font-mono text-xs text-foreground break-all">
          {rawKey}
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={copy}
            className="inline-flex h-8 items-center rounded-full bg-foreground px-4 text-xs font-medium text-background hover:bg-foreground/90"
          >
            Copy
          </button>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 items-center rounded-full border border-border px-4 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
