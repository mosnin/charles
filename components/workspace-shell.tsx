'use client';

/**
 * WorkspaceShell — the only chrome the founder sees.
 *
 * A 48px top bar (workspace name · ⌘K hint · user button) and a single
 * scroll region for the page. No sidebar. ⌘K opens the command palette,
 * which is the way you navigate.
 */

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { UserButton } from '@clerk/nextjs';
import { Command } from 'lucide-react';
import { CommandPalette, useCommandPaletteHotkey } from '@/components/command-palette';

interface Props {
  slug: string;
  workspaceName: string;
  children: React.ReactNode;
}

export function WorkspaceShell({ slug, workspaceName, children }: Props) {
  const [open, setOpen] = useState(false);
  const onOpen = useCallback(() => setOpen(true), []);
  useCommandPaletteHotkey(onOpen);

  const display = workspaceName.length > 32 ? workspaceName.slice(0, 32).trimEnd() + '…' : workspaceName;

  return (
    <>
      <header className="flex h-12 items-center border-b border-border/60 px-4 gap-4 flex-shrink-0">
        <Link
          href={`/s/${slug}`}
          className="text-sm font-medium text-foreground/90 hover:text-foreground transition-colors truncate max-w-[40%]"
        >
          {display}
        </Link>

        <div className="flex-1 flex items-center justify-center">
          <button
            type="button"
            onClick={onOpen}
            className="hidden md:inline-flex items-center gap-2 h-7 rounded-md border border-border/60 bg-background px-2.5 text-[12px] text-muted-foreground hover:text-foreground hover:border-border transition-colors"
            aria-label="Open command palette"
          >
            <span>Jump anywhere.</span>
            <kbd className="text-[11px] font-mono text-muted-foreground/70">⌘K</kbd>
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onOpen}
            className="md:hidden inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-foreground/[0.04] transition-colors"
            aria-label="Open command palette"
          >
            <Command size={16} />
          </button>
          <UserButton />
        </div>
      </header>

      <main className="flex-1 min-h-0 overflow-y-auto">{children}</main>

      <CommandPalette slug={slug} open={open} onOpenChange={setOpen} />
    </>
  );
}
