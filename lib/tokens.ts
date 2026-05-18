/**
 * Design tokens — the code-side mirror of STYLESHEET.md.
 *
 * STYLESHEET.md is the spec. This file is the spec made callable so a
 * surface (or an AI-assist session) can reach for the canonical values
 * without re-reading the prose. If a value isn't here, it doesn't
 * exist — propose a STYLESHEET addition first, then mirror it.
 *
 * Three companion files already encode subsets of this:
 *   - lib/typography.ts  → class-name strings for type styles
 *   - lib/motion.ts      → framer-motion variants + durations
 *   - app/globals.css    → CSS custom properties for theme colors
 * This file complements them with the raw token values + a few things
 * the others don't carry (the named spacing scale, the canonical
 * neutral palette, the brand palette). Where it overlaps with the
 * others (durations, easing), the values are the same — kept in sync
 * by the test `tokens-shape.test.ts`.
 *
 * Do not write Tailwind classes in product code that don't trace back
 * to one of these tokens. If you want `text-[15px]`, you're wrong;
 * STYLESHEET allows 12, 14, 16, 20, 28, 40 only.
 */

// ── Typography ──────────────────────────────────────────────────────────

/** The six font sizes — px. No others exist. */
export const FONT_SIZE = {
  xs: 12,
  sm: 14,
  base: 16,
  lg: 20,
  xl: 28,
  hero: 40,
} as const;

export type FontSizeKey = keyof typeof FONT_SIZE;

/** Weights in use — 400 (body), 500 (UI labels + buttons), 600 (wordmark + headings). */
export const FONT_WEIGHT = {
  body: 400,
  ui: 500,
  heading: 600,
} as const;

/** Line heights as decimal ratios. STYLESHEET: 1.5 body, 1.4 UI, 1.2 heading, 1.1 hero. */
export const LINE_HEIGHT = {
  body: 1.5,
  ui: 1.4,
  heading: 1.2,
  hero: 1.1,
} as const;

/** Negative tracking only on the two largest sizes. Everywhere else: 0. */
export const TRACKING = {
  tight: '-0.01em',
  normal: '0',
} as const;

// ── Spacing — the 4-pt grid, named scale ────────────────────────────────

/** Spacing scale — px. STYLESHEET: every margin / padding / gap is a multiple of 4. */
export const SPACE = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 40,
  '2xl': 64,
} as const;

export type SpaceKey = keyof typeof SPACE;

// ── Layout widths ──────────────────────────────────────────────────────

export const MAX_WIDTH = {
  /** Marketing pages — hero, body, footer all inside 960. */
  marketing: 960,
  /** Chat is reading, not browsing. */
  chat: 720,
  /** Modal dialog cap. */
  modal: 480,
} as const;

// ── Color — named roles, hex values from STYLESHEET ────────────────────

/** Brand colors. Each has a role, not a vibe. */
export const COLOR = {
  /** Charles signature — primary buttons, the approval banner, focal moments. */
  accent: '#0A0A0F',
  /** Successful approvals, shipped, sent, positive delta. */
  positive: '#1F6E3A',
  /** Approval pending, awaiting decision, attention-needed. */
  warning: '#B7791F',
  /** Decline, fire, delete, irreversible spend. Buttons only. */
  destructive: '#8B1A1A',
} as const;

/** Nine-step neutral scale (light → dark). Surfaces, borders, body, muted, etc. */
export const NEUTRAL = {
  50: '#fafafa',
  100: '#f4f4f5',
  200: '#e4e4e7',
  300: '#d4d4d8',
  400: '#a1a1aa',
  500: '#71717a',
  600: '#52525b',
  700: '#27272a',
  900: '#0a0a0a',
} as const;

// ── Radius ─────────────────────────────────────────────────────────────

/** Border radii in px. STYLESHEET-defined component radii. */
export const RADIUS = {
  /** Buttons, inputs, dropdowns. */
  sm: 8,
  /** Cards, popovers. */
  md: 12,
  /** Modals. */
  lg: 16,
  /** Pills, chips. */
  full: 9999,
} as const;

// ── Motion ─────────────────────────────────────────────────────────────

/** One easing curve. Fast out, soft in. No bounce, no spring. */
export const EASING = 'cubic-bezier(0.2, 0.8, 0.2, 1)' as const;

/** Three durations only. STYLESHEET ceiling is 400ms — nothing longer. */
export const DURATION = {
  /** Hover, focus, micro (button press, checkbox). */
  micro: 120,
  /** Panels, modals, drawers, sheets. */
  base: 240,
  /** Hard ceiling — if a transition wants 500ms, it's a redesign. */
  ceiling: 400,
} as const;

/** Things that are explicitly banned. Surfaced as a list for grep-friendly
 *  enforcement (e.g. a CI check could look for these substrings in product
 *  CSS). Keep in sync with STYLESHEET.md "Banned". */
export const BANNED_MOTION = [
  'bounce',
  'glow',
  'pulse-loop',
  'parallax',
  'scroll-jacking',
  'marquee',
  'confetti',
] as const;

// ── Borders ────────────────────────────────────────────────────────────

/** Hairlines carry structure. No shadows. */
export const BORDER_WIDTH = 1;

// ── Public namespace ───────────────────────────────────────────────────

/** Convenience: import { tokens } and reach for tokens.color.accent etc. */
export const tokens = {
  fontSize: FONT_SIZE,
  fontWeight: FONT_WEIGHT,
  lineHeight: LINE_HEIGHT,
  tracking: TRACKING,
  space: SPACE,
  maxWidth: MAX_WIDTH,
  color: COLOR,
  neutral: NEUTRAL,
  radius: RADIUS,
  easing: EASING,
  duration: DURATION,
  bannedMotion: BANNED_MOTION,
  borderWidth: BORDER_WIDTH,
} as const;
