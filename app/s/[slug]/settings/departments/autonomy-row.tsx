'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import {
  AUTONOMY_LEVELS,
  type AutonomyLevel,
  type DepartmentSlug,
} from '@/lib/departments/autonomy';

// The level labels as the founder sees them. The semantics ARE the contract;
// we don't explain. Sentence-case per STYLESHEET.md voice rules.
const LEVEL_LABEL: Record<AutonomyLevel, string> = {
  observe: 'Observe',
  ask: 'Ask',
  'auto-low': 'Auto-low',
  autonomous: 'Autonomous',
};

interface AutonomyRowProps {
  slug: DepartmentSlug;
  name: string;
  role: string;
  initialLevel: AutonomyLevel;
}

export function AutonomyRow({ slug, name, role, initialLevel }: AutonomyRowProps) {
  // Optimistic state: flip immediately, revert on failure.
  const [level, setLevel] = useState<AutonomyLevel>(initialLevel);
  const [_, startTransition] = useTransition();

  async function selectLevel(next: AutonomyLevel) {
    if (next === level) return;
    const prev = level;
    setLevel(next);

    startTransition(async () => {
      try {
        const res = await fetch(`/api/departments/${slug}/autonomy`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ autonomyLevel: next }),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error || 'Could not save the change.');
        }
        toast.success(`${name} set to ${LEVEL_LABEL[next].toLowerCase()}.`);
      } catch (err) {
        setLevel(prev);
        const msg = err instanceof Error ? err.message : 'Could not save the change.';
        toast.error(msg);
      }
    });
  }

  return (
    <div className="flex items-center justify-between gap-6 py-5">
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">{name}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{role}</p>
      </div>

      <div
        role="radiogroup"
        aria-label={`${name} autonomy level`}
        className="inline-flex flex-shrink-0 rounded-lg border border-border bg-muted/40 p-0.5"
      >
        {AUTONOMY_LEVELS.map((lvl) => {
          const selected = lvl === level;
          return (
            <button
              key={lvl}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => selectLevel(lvl)}
              className={
                'px-3 h-7 rounded-md text-xs font-medium transition-colors duration-150 ' +
                (selected
                  ? 'bg-background text-foreground shadow-sm shadow-foreground/[0.04]'
                  : 'text-muted-foreground hover:text-foreground')
              }
            >
              {LEVEL_LABEL[lvl]}
            </button>
          );
        })}
      </div>
    </div>
  );
}
