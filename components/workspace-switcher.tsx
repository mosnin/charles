'use client';

/**
 * WorkspaceSwitcher — top-bar dropdown for founders who run multiple bets.
 *
 * Click the workspace name → see every workspace you own or belong to →
 * jump. Desktop uses a Radix dropdown anchored to the trigger; mobile uses
 * a bottom sheet so the list is reachable with a thumb. One controlled
 * `open` state, two presentations.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronsUpDown, Check, Plus } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import type { UserSpace } from '@/lib/space/list-for-user';

interface Props {
  current: { slug: string; name: string };
  spaces: UserSpace[];
  /** Path to the new-workspace flow. Defaults to /onboarding?new=1. */
  newWorkspaceHref?: string;
}

const MOBILE_QUERY = '(max-width: 767px)';

function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia(MOBILE_QUERY);
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return isMobile;
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max).trimEnd() + '…' : text;
}

export function WorkspaceSwitcher({
  current,
  spaces,
  newWorkspaceHref = '/onboarding?new=1',
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const isMobile = useIsMobile();

  const goTo = (slug: string) => {
    setOpen(false);
    router.push(`/s/${slug}`);
  };

  const goNew = () => {
    setOpen(false);
    router.push(newWorkspaceHref);
  };

  const displayMobile = truncate(current.name, 20);
  const displayDesktop = truncate(current.name, 32);

  const triggerLabel = (
    <span className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground/90 hover:text-foreground transition-colors max-w-[55%] md:max-w-[40%]">
      <span className="md:hidden truncate">{displayMobile}</span>
      <span className="hidden md:inline truncate">{displayDesktop}</span>
      <ChevronsUpDown size={14} className="text-muted-foreground/70 shrink-0" aria-hidden />
    </span>
  );

  const list = (
    <>
      {spaces.map((s) => (
        <SwitcherRow
          key={s.id}
          space={s}
          onSelect={() => goTo(s.slug)}
        />
      ))}
      {spaces.length === 0 && (
        <div className="px-2 py-1.5 text-sm text-muted-foreground">No workspaces yet.</div>
      )}
    </>
  );

  if (isMobile) {
    return (
      <>
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Switch workspace"
          className="inline-flex items-center"
        >
          {triggerLabel}
        </button>
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent side="bottom" className="rounded-t-xl p-0 pb-4">
            <SheetHeader className="p-4 pb-2">
              <SheetTitle className="text-sm font-medium">Workspaces</SheetTitle>
            </SheetHeader>
            <div className="flex flex-col px-2">
              {spaces.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => goTo(s.slug)}
                  className="flex items-center gap-3 rounded-md px-3 py-3 text-left text-sm hover:bg-foreground/[0.04] active:bg-foreground/[0.06]"
                >
                  <SwitcherRowContent space={s} />
                </button>
              ))}
              {spaces.length === 0 && (
                <div className="px-3 py-3 text-sm text-muted-foreground">No workspaces yet.</div>
              )}
              <div className="my-1 h-px bg-border/60" />
              <button
                type="button"
                onClick={goNew}
                className="flex items-center gap-2 rounded-md px-3 py-3 text-left text-sm hover:bg-foreground/[0.04] active:bg-foreground/[0.06]"
              >
                <Plus size={14} className="text-muted-foreground" />
                New workspace
              </button>
            </div>
          </SheetContent>
        </Sheet>
      </>
    );
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        aria-label="Switch workspace"
        className="inline-flex items-center outline-hidden focus-visible:ring-2 focus-visible:ring-ring/30 rounded"
      >
        {triggerLabel}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        {list}
        {spaces.length > 0 && <DropdownMenuSeparator />}
        <DropdownMenuItem onSelect={goNew} className="gap-2">
          <Plus size={14} className="text-muted-foreground" />
          <span>New workspace</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SwitcherRow({
  space,
  onSelect,
}: {
  space: UserSpace;
  onSelect: () => void;
}) {
  return (
    <DropdownMenuItem onSelect={onSelect} className="gap-3 py-2">
      <SwitcherRowContent space={space} />
    </DropdownMenuItem>
  );
}

function SwitcherRowContent({ space }: { space: UserSpace }) {
  return (
    <>
      <div className="flex flex-1 min-w-0 flex-col">
        <span className="truncate text-sm text-foreground">{space.name}</span>
        <span className="truncate text-[11px] text-muted-foreground">
          owned by {space.ownerName}
        </span>
      </div>
      <span
        className={cn(
          'font-mono text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded',
          space.role === 'owner'
            ? 'bg-foreground/[0.08] text-foreground/80'
            : 'bg-foreground/[0.04] text-muted-foreground',
        )}
      >
        {space.role}
      </span>
      <span className="w-4 flex items-center justify-center">
        {space.isCurrent && <Check size={14} className="text-foreground" />}
      </span>
    </>
  );
}
