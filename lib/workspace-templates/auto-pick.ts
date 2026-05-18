/**
 * Auto-pick a workspace template from the founder's idea stage.
 *
 * The new 10-screen onboarding flow drops the explicit template picker
 * and instead infers a starting template from where the founder says
 * they are with the idea. We map onto existing template slugs only —
 * the catalog is closed at 5 by deliberate design (see catalog.ts).
 */

import type { WorkspaceTemplateSlug } from './catalog';

export type FounderIdeaStage =
  | 'pre-idea'
  | 'idea'
  | 'pre-mvp'
  | 'mvp'
  | 'customers'
  | 'revenue'
  | 'public';

export const FOUNDER_IDEA_STAGES: readonly FounderIdeaStage[] = [
  'pre-idea',
  'idea',
  'pre-mvp',
  'mvp',
  'customers',
  'revenue',
  'public',
] as const;

export function isFounderIdeaStage(s: unknown): s is FounderIdeaStage {
  return (
    typeof s === 'string' &&
    (FOUNDER_IDEA_STAGES as readonly string[]).includes(s)
  );
}

/** Slug returned when nothing maps — also returned for `undefined`. */
export const DEFAULT_AUTO_PICK_SLUG: WorkspaceTemplateSlug = 'saas-b2b';

/**
 * Map an idea stage onto one of the 5 existing workspace template slugs.
 *
 * Reasoning (closest fit, not a perfect one):
 *   - pre-idea / idea   → open-source        (build-in-public is the
 *                                              cheapest way to find an
 *                                              audience before product
 *                                              exists).
 *   - pre-mvp / mvp     → saas-b2b           (the default builder shape —
 *                                              ship, charge, iterate).
 *   - customers         → consumer-marketplace (early demand-side work,
 *                                                liquidity over revenue).
 *   - revenue           → b2b-agency         (revenue without product
 *                                              maps to services first).
 *   - public            → physical-product   (shipping atoms — the
 *                                              "scale ops" shape we have).
 *   - undefined         → DEFAULT_AUTO_PICK_SLUG.
 *
 * If a caller passes a templateSlug explicitly, the route uses that and
 * never calls this function.
 */
export function autoPickTemplateForStage(
  stage: FounderIdeaStage | undefined,
): WorkspaceTemplateSlug {
  switch (stage) {
    case 'pre-idea':
    case 'idea':
      return 'open-source';
    case 'pre-mvp':
    case 'mvp':
      return 'saas-b2b';
    case 'customers':
      return 'consumer-marketplace';
    case 'revenue':
      return 'b2b-agency';
    case 'public':
      return 'physical-product';
    case undefined:
    default:
      return DEFAULT_AUTO_PICK_SLUG;
  }
}
