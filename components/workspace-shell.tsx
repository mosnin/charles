'use client';

/**
 * WorkspaceShell — the only chrome the founder sees.
 *
 * A 48px top bar (workspace name · ⌘K hint · user button) and a single
 * scroll region for the page. No sidebar. ⌘K opens the command palette,
 * which is the way you navigate.
 *
 * Responsive contract:
 *   - Workspace name truncates at ~20 chars on mobile, ~32 chars on md+.
 *   - The "Jump anywhere · ⌘K" pill is hidden below md (no keyboard) — the
 *     command icon button on the right opens the palette by tap.
 *   - The command palette modal itself is touch-friendly (own spec).
 */

import { useCallback, useState } from 'react';
import { UserButton } from '@clerk/nextjs';
import { Command } from 'lucide-react';
import { CommandPalette, useCommandPaletteHotkey } from '@/components/command-palette';
import { WorkspaceThemeToggle } from '@/components/workspace-theme-toggle';
import { WorkspaceSwitcher } from '@/components/workspace-switcher';
import { PresencePills } from '@/components/canvas/presence-pills';
import type { UserSpace } from '@/lib/space/list-for-user';

interface Props {
  slug: string;
  spaceId: string;
  workspaceName: string;
  spaces: UserSpace[];
  children: React.ReactNode;
}

export function WorkspaceShell({ slug, spaceId, workspaceName, spaces, children }: Props) {
  const [open, setOpen] = useState(false);
  const onOpen = useCallback(() => setOpen(true), []);
  useCommandPaletteHotkey(onOpen);

  return (
    <>
      <header className="flex h-12 items-center border-b border-border/60 px-4 gap-4 flex-shrink-0">
        <WorkspaceSwitcher
          current={{ slug, name: workspaceName }}
          spaces={spaces}
        />

        <PresencePills slug={slug} spaceId={spaceId} />

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
          <WorkspaceThemeToggle />
          <UserButton />
        </div>
      </header>

      <main className="flex-1 min-h-0 overflow-y-auto">{children}</main>

      <CommandPalette slug={slug} open={open} onOpenChange={setOpen} />
    </>
  );
}
