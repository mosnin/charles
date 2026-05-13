/**
 * Workspace nav.
 *
 * There is no sidebar. ⌘K opens the command palette, which is the way you
 * navigate Charles. The catalog lives in `lib/command-palette.ts`; this
 * module re-exports the workspace subset for any caller that wants just
 * the top-level destinations (e.g. a future mobile bottom nav).
 */
import { COMMAND_ITEMS, type CommandItem } from '@/lib/command-palette';

export const workspaceNavItems: readonly CommandItem[] = COMMAND_ITEMS.filter(
  (i) => i.group === 'Workspace' && i.kind === 'nav',
);

export type { CommandItem };
