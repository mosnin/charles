import type { Variants, Transition } from 'framer-motion';

/**
 * Motion tokens — match STYLESHEET.md exactly. One easing curve. Three
 * durations. Values mirror lib/tokens.ts in seconds (framer-motion
 * convention); the cross-file pin lives in tests/lib/tokens-shape.test.ts.
 *
 * Pre-phase-6 drift cleaned up here: EASE_OUT was [0.16, 1, 0.3, 1]
 * (Apple-ish) and durations were 150/220/320ms — close, but STYLESHEET
 * is the spec and the spec wins. Visible diff is subtle: slightly
 * gentler easing, 120/240/400ms ladder.
 */

/** One easing curve. Fast out, soft in. No bounce, no spring. */
export const EASE_OUT: [number, number, number, number] = [0.2, 0.8, 0.2, 1];
/** Reserved for cases that explicitly need the symmetric in-out. Most
 *  product motion uses EASE_OUT alone. */
export const EASE_IN_OUT: [number, number, number, number] = [0.4, 0, 0.2, 1];

/** Hover, focus, micro (button press, checkbox). 120ms. */
export const DURATION_FAST = 0.12;
/** Panels, modals, drawers, sheets. 240ms. */
export const DURATION_BASE = 0.24;
/** Hard ceiling — 400ms. Anything longer is a redesign, not a duration tweak. */
export const DURATION_SLOW = 0.4;

/** Page-level fade + tiny y-translate. */
export const PAGE_VARIANTS: Variants = {
  initial: { opacity: 0, y: 4 },
  enter: { opacity: 1, y: 0, transition: { duration: DURATION_BASE, ease: EASE_OUT } },
  exit: { opacity: 0, transition: { duration: DURATION_FAST } },
};

/** Stagger container — children animate in sequence. */
export const STAGGER_CONTAINER: Variants = {
  initial: { opacity: 1 },
  enter: { opacity: 1, transition: { staggerChildren: 0.04 } },
};

/** Stagger child — fade + tiny y. Use inside STAGGER_CONTAINER. */
export const STAGGER_ITEM: Variants = {
  initial: { opacity: 0, y: 4 },
  enter: { opacity: 1, y: 0, transition: { duration: DURATION_BASE, ease: EASE_OUT } },
};

/** Hover scale for rows/cards — very subtle. */
export const HOVER_ROW: Transition = { duration: DURATION_FAST };

/** Modal/dialog content variant. */
export const DIALOG_VARIANTS: Variants = {
  initial: { opacity: 0, scale: 0.97, y: 4 },
  enter: { opacity: 1, scale: 1, y: 0, transition: { duration: DURATION_BASE, ease: EASE_OUT } },
  exit: { opacity: 0, scale: 0.97, transition: { duration: DURATION_FAST } },
};
