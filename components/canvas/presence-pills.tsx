'use client';

/**
 * PresencePills — a compact stack of avatar pills in the top bar.
 *
 * Subscribes to Convex presence for the active space, renders up to three
 * 24px avatars with overlap and a +N overflow chip. Each pill tooltip
 * shows "{name} - on {surface}". Empty by default — no chrome until
 * someone else is actually here.
 */

import { useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { usePresence, type PresentUser } from '@/lib/convex/use-presence';
import { friendlySurface } from '@/lib/convex/surface-labels';
import { cn } from '@/lib/utils';

const PRESS_FEEDBACK_MS = 100;

interface Props {
  slug: string;
  spaceId: string;
  className?: string;
}

const MAX_VISIBLE = 3;

export function PresencePills({ slug, spaceId, className }: Props) {
  const present = usePresence({ spaceId });
  if (!present.length) return null;

  const visible = present.slice(0, MAX_VISIBLE);
  const overflow = present.length - visible.length;

  return (
    <div
      className={cn('flex items-center pl-2', className)}
      aria-label={`${present.length} other ${present.length === 1 ? 'founder' : 'founders'} here`}
    >
      {visible.map((u, i) => (
        <AvatarPill key={u.userId} user={u} slug={slug} zIndex={MAX_VISIBLE - i} />
      ))}
      {overflow > 0 && (
        <span
          className="-ml-2 inline-flex h-6 min-w-6 items-center justify-center rounded-full border-2 border-background bg-muted px-1.5 text-[10px] font-medium text-muted-foreground"
          style={{ zIndex: 0 }}
          aria-label={`${overflow} more`}
        >
          +{overflow}
        </span>
      )}
    </div>
  );
}

function AvatarPill({
  user,
  slug,
  zIndex,
}: {
  user: PresentUser;
  slug: string;
  zIndex: number;
}) {
  const [hover, setHover] = useState(false);
  const [pressed, setPressed] = useState(false);
  const router = useRouter();
  const pathname = usePathname() ?? '';
  const label = friendlySurface(user.surface, slug);
  const initials = initialsOf(user.userName);

  // Already there → click is a no-op. Visually subtle: half-opacity to
  // signal the action is grayed out, no ring change so the row doesn't
  // jitter when a peer's surface flickers.
  const isHere = user.surface === pathname;

  function onClick() {
    const target = followTargetFor(pathname, user.surface);
    if (!target) return;
    setPressed(true);
    window.setTimeout(() => setPressed(false), PRESS_FEEDBACK_MS);
    // Navigation only. No audit event, no toast, no side effect.
    // router.push (not replace) so the founder can hit Back to return.
    router.push(target);
  }

  return (
    <div
      className="relative -ml-2 first:ml-0"
      style={{ zIndex }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
    >
      <button
        type="button"
        tabIndex={0}
        aria-label={
          isHere
            ? `${user.userName} is here on ${label}`
            : `Follow ${user.userName} to ${label}`
        }
        data-testid={`presence-pill-${user.userId}`}
        data-here={isHere ? 'true' : undefined}
        onClick={onClick}
        className={cn(
          'block h-6 w-6 overflow-hidden rounded-full border-2 border-background bg-muted text-[10px] font-medium text-muted-foreground transition-transform duration-100 ease-out',
          isHere && 'opacity-60 cursor-default',
          !isHere && 'cursor-pointer hover:opacity-90',
          pressed && 'scale-90',
        )}
      >
        {user.userImage ? (
          // Plain <img> — Clerk URLs are external CDN; next/image isn't worth the cost here.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={user.userImage}
            alt=""
            className="h-full w-full object-cover"
            referrerPolicy="no-referrer"
          />
        ) : (
          <span className="flex h-full w-full items-center justify-center">{initials}</span>
        )}
      </button>
      {hover && (
        <span
          role="tooltip"
          className="pointer-events-none absolute left-1/2 top-[calc(100%+6px)] z-50 -translate-x-1/2 whitespace-nowrap rounded-md border border-border/60 bg-popover px-2 py-1 text-[11px] text-popover-foreground shadow-sm"
        >
          {user.userName} <span className="text-muted-foreground">on {label}</span>
        </span>
      )}
    </div>
  );
}

/**
 * Pure logic for follow-mode click. Extracted so the navigation decision
 * is unit-testable without rendering React. Returns the target the click
 * should route to, or null when the click is a no-op (user already there).
 */
export function followTargetFor(
  currentPathname: string,
  userSurface: string,
): string | null {
  if (!userSurface) return null;
  if (currentPathname === userSurface) return null;
  return userSurface;
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
