'use client';

/**
 * Charles command palette.
 *
 * Universal launcher. ⌘K opens; Esc closes; ↑/↓ navigates; ↵ selects;
 * typing filters nav + actions locally and, after a 200ms debounce on 2+
 * characters, fetches workspace content (documents, tasks, gates, drafts)
 * from /api/search. Arrow keys nav across every visible row.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useClerk } from '@clerk/nextjs';
import {
  CheckSquare,
  FileText,
  Inbox,
  Search as SearchIcon,
} from 'lucide-react';
import {
  COMMAND_GROUPS,
  COMMAND_ITEMS,
  matchCommands,
  type CommandGroup,
  type CommandItem,
} from '@/lib/command-palette';
import { iconForStageGate } from '@/lib/icons/manifest';
import { cn } from '@/lib/utils';

interface Props {
  /** Workspace slug — prefixed to every nav href at render time. */
  slug: string;
  /** Open state owned by parent so the top-bar trigger can flip it. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface DocumentHit {
  kind: 'document';
  id: string;
  slug: string;
  title: string;
  snippet: string;
  href: string;
}
interface TaskHit {
  kind: 'task';
  id: string;
  title: string;
  snippet: string;
  status: string;
  priority: string;
  href: string;
}
interface GateHit {
  kind: 'gate';
  id: string;
  title: string;
  stage: string;
  isComplete: boolean;
  href: string;
}
interface DraftHit {
  kind: 'draft';
  id: string;
  intent: string;
  title: string;
  snippet: string;
  status: string;
  href: string;
}
type ContentHit = DocumentHit | TaskHit | GateHit | DraftHit;

interface SearchResults {
  documents: DocumentHit[];
  tasks: TaskHit[];
  gates: GateHit[];
  drafts: DraftHit[];
}

const EMPTY_RESULTS: SearchResults = { documents: [], tasks: [], gates: [], drafts: [] };

export function CommandPalette({ slug, open, onOpenChange }: Props) {
  const router = useRouter();
  const clerk = useClerk();
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [results, setResults] = useState<SearchResults>(EMPTY_RESULTS);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Reset on open.
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActiveIndex(0);
    setResults(EMPTY_RESULTS);
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

  // Debounced content search — only fires when palette is open and q is 2+ chars.
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (q.length < 2) {
      setResults(EMPTY_RESULTS);
      // Cancel any in-flight request — the user wiped the query.
      abortRef.current?.abort();
      abortRef.current = null;
      return;
    }

    const timer = window.setTimeout(() => {
      // Cancel the previous fetch before starting a new one.
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal })
        .then((r) => (r.ok ? r.json() : EMPTY_RESULTS))
        .then((data: SearchResults) => {
          if (ctrl.signal.aborted) return;
          setResults({
            documents: data.documents ?? [],
            tasks: data.tasks ?? [],
            gates: data.gates ?? [],
            drafts: data.drafts ?? [],
          });
        })
        .catch(() => {
          // Aborted or network error — keep prior results, no UI flicker.
        });
    }, 200);

    return () => window.clearTimeout(timer);
  }, [query, open]);

  const filtered = useMemo(() => matchCommands(query), [query]);

  // Flat ordered list across every group (commands + content) for keyboard nav.
  const flat = useMemo(() => {
    const out: { kind: 'command'; item: CommandItem }[] = [];
    const items: Array<{ kind: 'command'; item: CommandItem } | { kind: 'content'; hit: ContentHit }> = [];
    for (const g of COMMAND_GROUPS) {
      for (const item of filtered.filter((i) => i.group === g)) {
        items.push({ kind: 'command', item });
      }
    }
    for (const hit of results.documents) items.push({ kind: 'content', hit });
    for (const hit of results.tasks) items.push({ kind: 'content', hit });
    for (const hit of results.gates) items.push({ kind: 'content', hit });
    for (const hit of results.drafts) items.push({ kind: 'content', hit });
    return items;
  }, [filtered, results]);

  useEffect(() => {
    setActiveIndex(0);
  }, [flat.length]);

  const runCommand = useCallback(
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

  const runContent = useCallback(
    (hit: ContentHit) => {
      onOpenChange(false);
      router.push(`/s/${slug}${hit.href}`);
    },
    [router, slug, onOpenChange],
  );

  function onInputKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, flat.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const entry = flat[activeIndex];
      if (!entry) return;
      if (entry.kind === 'command') runCommand(entry.item);
      else runContent(entry.hit);
    }
  }

  if (!open) return null;

  // Group commands by COMMAND_GROUPS order. Content groups append below.
  const groupedCommands: { group: CommandGroup; items: CommandItem[] }[] = [];
  for (const g of COMMAND_GROUPS) {
    const items = filtered.filter((i) => i.group === g);
    if (items.length > 0) groupedCommands.push({ group: g, items });
  }

  const contentGroups: { label: string; hits: ContentHit[] }[] = [
    { label: 'Documents', hits: results.documents },
    { label: 'Tasks', hits: results.tasks },
    { label: 'Stage gates', hits: results.gates },
    { label: 'Drafts', hits: results.drafts },
  ].filter((g) => g.hits.length > 0);

  const hasAny = groupedCommands.length > 0 || contentGroups.length > 0;

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
          {!hasAny ? (
            <div className="px-4 py-10 text-center text-sm text-muted-foreground">
              No matches.
            </div>
          ) : (
            <>
              {groupedCommands.map((g) => (
                <div key={g.group} className="py-1">
                  <p className="px-4 pt-2 pb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
                    {g.group}
                  </p>
                  {g.items.map((item) => {
                    const idx = flat.findIndex(
                      (e) => e.kind === 'command' && e.item.id === item.id,
                    );
                    const active = idx === activeIndex;
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onMouseEnter={() => setActiveIndex(idx)}
                        onClick={() => runCommand(item)}
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
              ))}

              {contentGroups.map((g) => (
                <div key={g.label} className="py-1">
                  <p className="px-4 pt-2 pb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
                    {g.label}
                  </p>
                  {g.hits.map((hit) => {
                    const idx = flat.findIndex(
                      (e) =>
                        e.kind === 'content' &&
                        e.hit.kind === hit.kind &&
                        e.hit.id === hit.id,
                    );
                    const active = idx === activeIndex;
                    return (
                      <ContentRow
                        key={`${hit.kind}-${hit.id}`}
                        hit={hit}
                        groupLabel={g.label}
                        active={active}
                        onHover={() => setActiveIndex(idx)}
                        onClick={() => runContent(hit)}
                      />
                    );
                  })}
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ContentRow({
  hit,
  groupLabel,
  active,
  onHover,
  onClick,
}: {
  hit: ContentHit;
  groupLabel: string;
  active: boolean;
  onHover: () => void;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onMouseEnter={onHover}
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-3 px-4 py-2 text-left transition-colors duration-120',
        active ? 'bg-foreground/[0.06]' : 'hover:bg-foreground/[0.03]',
      )}
    >
      <HitIcon hit={hit} active={active} />
      <span className="flex-1 min-w-0">
        <span
          className={cn(
            'block truncate text-sm',
            active ? 'text-foreground font-medium' : 'text-foreground/90',
          )}
        >
          {titleFor(hit)}
        </span>
        {snippetFor(hit) && (
          <span className="block truncate text-xs text-muted-foreground/80">
            {snippetFor(hit)}
          </span>
        )}
      </span>
      <span className="text-[11px] uppercase tracking-wider text-muted-foreground/60 flex-shrink-0">
        {groupLabel}
      </span>
    </button>
  );
}

function titleFor(hit: ContentHit): string {
  if (hit.kind === 'draft') return hit.title || hit.intent;
  return hit.title;
}

function snippetFor(hit: ContentHit): string {
  if (hit.kind === 'document') return hit.snippet;
  if (hit.kind === 'task') return hit.snippet;
  if (hit.kind === 'draft') return hit.snippet;
  return '';
}

function HitIcon({ hit, active }: { hit: ContentHit; active: boolean }) {
  const cls = cn('flex-shrink-0', active ? 'text-foreground' : 'text-muted-foreground');
  if (hit.kind === 'document') return <FileText size={16} className={cls} />;
  if (hit.kind === 'task') return <CheckSquare size={16} className={cls} />;
  if (hit.kind === 'draft') return <Inbox size={16} className={cls} />;
  // Gate: pixel-art icon from the manifest, rendered as <img>.
  const src = iconForStageGate(hit.title);
  return (
    <img
      src={src}
      alt=""
      width={16}
      height={16}
      className={cn('flex-shrink-0', active ? 'opacity-100' : 'opacity-70')}
      aria-hidden="true"
    />
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
