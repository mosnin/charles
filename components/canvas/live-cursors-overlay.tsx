'use client';

/**
 * LiveCursorsOverlay — presence-only cursor dots.
 *
 * Renders one absolutely-positioned dot + name label per OTHER user on the
 * same surface. Position is the user's reported viewport coordinates,
 * translated into the container's local coordinate space so the dot tracks
 * even when the editor scrolls. This is decoration, NOT collaborative
 * editing — TipTap's collab extensions are deliberately not wired in.
 */

import { useEffect, useRef, useState } from 'react';
import type { PresentUser } from '@/lib/convex/use-presence';
import { hashUserIdToColor, cursorColorHex } from '@/lib/convex/cursor-color';

interface Props {
  otherUsers: PresentUser[];
  /** Container the cursor coordinates are translated into. */
  containerRef: React.RefObject<HTMLElement | null>;
  /** Only show cursors for users currently on this surface. */
  surfaceKey?: string;
}

export function LiveCursorsOverlay({ otherUsers, containerRef, surfaceKey }: Props) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const update = () => {
      const el = containerRef.current;
      if (el) setRect(el.getBoundingClientRect());
    };
    update();
    const onResize = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(update);
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onResize, true);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onResize, true);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [containerRef]);

  if (!rect) return null;

  const onThisSurface = surfaceKey
    ? otherUsers.filter((u) => u.surface === surfaceKey)
    : otherUsers;
  const cursorsHere = onThisSurface.filter(
    (u) => typeof u.cursorX === 'number' && typeof u.cursorY === 'number',
  );
  if (!cursorsHere.length) return null;

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-40"
      style={{ top: 0, left: 0 }}
    >
      {cursorsHere.map((u) => {
        const color = cursorColorHex(hashUserIdToColor(u.userId));
        const x = (u.cursorX ?? 0);
        const y = (u.cursorY ?? 0);
        return (
          <div
            key={u.userId}
            className="absolute transition-transform duration-200 ease-out"
            style={{
              transform: `translate3d(${x}px, ${y}px, 0)`,
              top: 0,
              left: 0,
            }}
          >
            <div
              className="h-3 w-3 rounded-full ring-2 ring-background"
              style={{ backgroundColor: color }}
            />
            <span
              className="mt-1 inline-block rounded-md px-1.5 py-0.5 text-[10px] font-medium text-white shadow-sm"
              style={{ backgroundColor: color }}
            >
              {u.userName}
            </span>
          </div>
        );
      })}
    </div>
  );
}
