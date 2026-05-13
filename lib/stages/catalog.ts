/**
 * Source of truth for the six stages a Charles company moves through.
 *
 * The catalog drives the UI checklist, the manager agent's lazy seeding
 * on stage advance, and the SQL fallback in seed_stage_gates. Gate
 * titles are the contract — if a title changes here, the Python mirror
 * and the SQL function have to match or the seeding drifts.
 */

export type Stage = 'idea' | 'initial' | 'identity' | 'building' | 'selling' | 'scaling';

export interface StageDef {
  /** Canonical stage slug. */
  slug: Stage;
  /** Display label, sentence case. */
  label: string;
  /** One-sentence answer to "what is this stage for?" */
  purpose: string;
  /** Ordered list of exit-gate titles. Index = `order` column in StageGate. */
  gates: readonly string[];
}

export const STAGE_ORDER: readonly Stage[] = [
  'idea',
  'initial',
  'identity',
  'building',
  'selling',
  'scaling',
] as const;

export const STAGES: Readonly<Record<Stage, StageDef>> = {
  idea: {
    slug: 'idea',
    label: 'Idea',
    purpose: "Charles knows what you're building and who it's for.",
    gates: [
      'Define your company in one sentence',
      'Identify your target customer',
      'Connect GitHub',
    ],
  },
  initial: {
    slug: 'initial',
    label: 'Initial',
    purpose: 'First working surface exists.',
    gates: [
      'Claim a domain or repo',
      'Capture the brand voice',
      'Ship a first product surface',
    ],
  },
  identity: {
    slug: 'identity',
    label: 'Identity',
    purpose: 'The product can be described to a stranger.',
    gates: [
      'Approve the logo and wordmark',
      'Publish the landing page',
      'Review the core copy',
      'Claim the social handles',
    ],
  },
  building: {
    slug: 'building',
    label: 'Building',
    purpose: 'Charles is shipping the product.',
    gates: [
      'Define the feature roadmap',
      'Deploy to production',
      'Run a real founder onboarding',
    ],
  },
  selling: {
    slug: 'selling',
    label: 'Selling',
    purpose: 'Money flowing in.',
    gates: [
      'Turn Stripe live',
      'Publish the pricing page',
      'Test the sales pitch',
      'Land the first paying customer',
    ],
  },
  scaling: {
    slug: 'scaling',
    label: 'Scaling',
    purpose: 'Charles defends the gains.',
    gates: [
      'Run a support flow',
      'Wire the ops dashboard',
      'Track runway weekly',
    ],
  },
} as const;

/** Ordered gate titles for the given stage. */
export function gatesForStage(stage: Stage): readonly string[] {
  return STAGES[stage].gates;
}

/** The stage after `stage`, or null if `stage` is the last one. */
export function nextStage(stage: Stage): Stage | null {
  const i = STAGE_ORDER.indexOf(stage);
  if (i < 0 || i >= STAGE_ORDER.length - 1) return null;
  return STAGE_ORDER[i + 1];
}

/** The stage before `stage`, or null if `stage` is the first one. */
export function prevStage(stage: Stage): Stage | null {
  const i = STAGE_ORDER.indexOf(stage);
  if (i <= 0) return null;
  return STAGE_ORDER[i - 1];
}
