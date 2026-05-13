'use client';

/**
 * Charles command palette.
 *
 * Universal launcher. ⌘K opens; Esc closes; ↑/↓ navigates; ↵ selects;
 * typing filters against label + keywords. Nav items push to the router;
 * action items invoke the host's callback.
 *
 * No third-party library — the catalog is small, the keystrokes are simple,
 * and adding cmdk/Radix would be ceremony.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useClerk } from '@clerk/nextjs';
import { Search as SearchIcon } from 'lucide-react';
import {
  COMMAND_GROUPS,
  COMMAND_ITEMS,
  matchCommands,
  type CommandGroup,
  type CommandItem,
} from '@/lib/command-palette';
import { cn } from '@/lib/utils';

interface Props {
  /** Workspace slug — prefixed to every nav href at render time. */
  slug: string;
  /** Open state owned by parent so the top-bar trigger can flip it. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CommandPalette({ slug, open, onOpenChange }: Props) {
  const router = useRouter();
  const clerk = useClerk();
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset on open.
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActiveIndex(0);
    const t = window.setTimeout(() => inputRef.current?.focus(), 10);
    return () => window.clearTimeout(t);
  }, [open]);

  // Esc to close.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onOpenChange(false);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onOpenChange]);

  const filtered = useMemo(() => matchCommands(query), [query]);

  useEffect(() => {
    setActiveIndex(0);
  }, [filtered.length]);

  const run = useCallback(
    (item: CommandItem) => {
      onOpenChange(false);
      if (item.kind === 'nav' && item.href !== undefined) {
        router.push(`/s/${slug}${item.href}`);
        return;
      }
      if (item.kind === 'action') {
        switch (item.action) {
          case 'sign-out':
            void clerk.signOut(() => router.push('/sign-in'));
            return;
          case 'new-task':
            router.push(`/s/${slug}/tasks?new=1`);
            return;
          case 'new-document':
            router.push(`/s/${slug}/documents`);
            return;
        }
      }
    },
    [router, slug, clerk, onOpenChange],
  );

  function onInputKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = filtered[activeIndex];
      if (item) run(item);
    }
  }

  if (!open) return null;

  // Group results, preserving group order from COMMAND_GROUPS.
  const grouped: { group: CommandGroup; items: CommandItem[] }[] = [];
  for (const g of COMMAND_GROUPS) {
    const items = filtered.filter((i) => i.group === g);
    if (items.length > 0) grouped.push({ group: g, items });
  }

  // Build a flat-index → item map so keyboard nav works across groups.
  const flat: CommandItem[] = grouped.flatMap((g) => g.items);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-black/40 backdrop-blur-sm pt-[14vh] px-4"
      onClick={() => onOpenChange(false)}
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      <div
        className="w-full max-w-[640px] rounded-2xl border border-border bg-background shadow-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 border-b border-border">
          <SearchIcon size={16} className="text-muted-foreground flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onInputKey}
            placeholder="Jump anywhere."
            className="flex-1 bg-transparent outline-none text-sm py-3.5 placeholder:text-muted-foreground/60"
            aria-label="Search commands"
          />
          <kbd className="hidden sm:inline-block text-[11px] font-mono text-muted-foreground/70">
            esc
          </kbd>
        </div>

        <div className="max-h-[60vh] overflow-y-auto py-1">
          {flat.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-muted-foreground">
              No matches.
            </div>
          ) : (
            grouped.map((g) => (
              <div key={g.group} className="py-1">
                <p className="px-4 pt-2 pb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
                  {g.group}
                </p>
                {g.items.map((item) => {
                  const idx = flat.indexOf(item);
                  const active = idx === activeIndex;
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onMouseEnter={() => setActiveIndex(idx)}
                      onClick={() => run(item)}
                      className={cn(
                        'w-full flex items-center gap-3 px-4 py-2 text-left transition-colors duration-120',
                        active ? 'bg-foreground/[0.06]' : 'hover:bg-foreground/[0.03]',
                      )}
                    >
                      <Icon
                        size={16}
                        className={cn(
                          'flex-shrink-0',
                          active ? 'text-foreground' : 'text-muted-foreground',
                        )}
                      />
                      <span
                        className={cn(
                          'flex-1 truncate text-sm',
                          active ? 'text-foreground font-medium' : 'text-foreground/90',
                        )}
                      >
                        {item.label}
                      </span>
                      {item.shortcut && (
                        <kbd className="text-[11px] font-mono text-muted-foreground/70">
                          {item.shortcut}
                        </kbd>
                      )}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

/** Exported so the host can wire ⌘K once and forward to the palette. */
export function useCommandPaletteHotkey(onOpen: () => void) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const isK = e.key === 'k' || e.key === 'K';
      if (isK && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onOpen();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onOpen]);
}

export { COMMAND_ITEMS };
