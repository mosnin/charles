'use client';

/**
 * The single-screen creation form.
 *
 * One input, one trigger picker, one button. POST returns an id; we
 * redirect into the builder. No second-pass "did you mean to set X?" —
 * everything else lives in the builder where it belongs.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { BODY, BODY_MUTED, PRIMARY_PILL, GHOST_PILL } from '@/lib/typography';
import { TRIGGER_TYPES, type TriggerType } from '@/lib/agent-templates/catalog';

export function NewTemplateForm({ spaceSlug }: { spaceSlug: string }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [triggerType, setTriggerType] = useState<TriggerType>('manual');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      setError('Name it first.');
      return;
    }
    startTransition(async () => {
      const res = await fetch('/api/agent-templates', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: trimmed, triggerType }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? 'Could not create.');
        return;
      }
      const data = (await res.json()) as { id: string };
      router.push(`/s/${spaceSlug}/agents/templates/${data.id}`);
    });
  }

  return (
    <form onSubmit={submit} className="space-y-8">
      <div className="space-y-2">
        <label className={cn(BODY, 'block font-medium')} htmlFor="template-name">
          Name
        </label>
        <input
          id="template-name"
          type="text"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={100}
          placeholder="Outbound research agent"
          className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-foreground focus:outline-none"
        />
      </div>

      <div className="space-y-3">
        <p className={cn(BODY, 'font-medium')}>Trigger</p>
        <div className="grid gap-2 md:grid-cols-2">
          {TRIGGER_TYPES.map((t) => {
            const active = t.type === triggerType;
            return (
              <button
                key={t.type}
                type="button"
                onClick={() => setTriggerType(t.type)}
                className={cn(
                  'rounded-lg border px-4 py-3 text-left transition-colors',
                  active
                    ? 'border-foreground bg-foreground/[0.04]'
                    : 'border-border/60 hover:border-border',
                )}
              >
                <p className={cn(BODY, 'font-medium')}>{t.label}</p>
                <p className={cn(BODY_MUTED, 'mt-0.5')}>{t.description}</p>
              </button>
            );
          })}
        </div>
      </div>

      {error && (
        <p className="text-sm text-rose-700" role="alert">
          {error}
        </p>
      )}

      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className={PRIMARY_PILL}>
          {pending ? 'Creating…' : 'Create'}
        </button>
        <button
          type="button"
          onClick={() => router.push(`/s/${spaceSlug}/agents/templates`)}
          className={GHOST_PILL}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
