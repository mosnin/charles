/**
 * Stable user-id → calm cursor color mapping.
 *
 * Hash any string into one of six muted Tailwind hues. The hash is
 * deterministic so a given userId always lands on the same color across
 * sessions and surfaces.
 */

export const CURSOR_COLORS = [
  'slate-500',
  'blue-500',
  'emerald-500',
  'amber-500',
  'rose-500',
  'violet-500',
] as const;

export type CursorColor = (typeof CURSOR_COLORS)[number];

const CURSOR_HEX: Readonly<Record<CursorColor, string>> = {
  'slate-500': '#64748b',
  'blue-500': '#3b82f6',
  'emerald-500': '#10b981',
  'amber-500': '#f59e0b',
  'rose-500': '#f43f5e',
  'violet-500': '#8b5cf6',
};

export function hashUserIdToColor(userId: string): CursorColor {
  let h = 0;
  for (let i = 0; i < userId.length; i++) {
    h = (h * 31 + userId.charCodeAt(i)) | 0;
  }
  const idx = Math.abs(h) % CURSOR_COLORS.length;
  return CURSOR_COLORS[idx];
}

export function cursorColorHex(name: CursorColor): string {
  return CURSOR_HEX[name];
}
