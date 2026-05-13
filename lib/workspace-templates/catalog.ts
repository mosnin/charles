/**
 * Workspace templates — opinionated starting points the founder picks at
 * onboarding (or anytime later from /s/[slug]/templates).
 *
 * Each template seeds:
 *   - Mission fields (only ones the founder hasn't already set)
 *   - CoreMemory slots (per-template defaults)
 *   - StageGate rows ON TOP of `lib/stages/catalog.ts` defaults
 *   - Document seeds (only if the doc is currently empty)
 *   - A recommended-integrations list (display only; surfacing is the
 *     integrations panel's job).
 *
 * The 5 templates here are the only templates that ever ship. If you find
 * yourself thinking about template #6, the answer is no — narrow the existing
 * ones, don't add another. Configuration is failure to decide.
 */
import type { Stage } from '@/lib/stages/catalog';
import type { DocumentSlug } from '@/lib/documents/catalog';

export type WorkspaceTemplateSlug =
  | 'saas-b2b'
  | 'consumer-marketplace'
  | 'b2b-agency'
  | 'open-source'
  | 'physical-product';

export interface WorkspaceTemplateMission {
  title?: string;
  oneLinePitch?: string;
  targetCustomer?: string;
  productDescription?: string;
}

export interface WorkspaceTemplate {
  slug: WorkspaceTemplateSlug;
  /** Founder-facing display name. Serif. */
  name: string;
  /** One-line, no fluff. Reads like a verdict. */
  blurb: string;
  /** 3-4 short chips for the template card. */
  highlights: readonly string[];
  /** Defaults the founder can keep or rewrite later. */
  mission: WorkspaceTemplateMission;
  /** Slot → value. Upserted into CoreMemory. */
  coreMemorySeeds: Readonly<Record<string, string>>;
  /** Toolkit slugs from `lib/integrations/catalog.ts`. */
  recommendedIntegrations: readonly string[];
  /** Extra gate titles, keyed by stage. Added on top of catalog defaults. */
  extraGates: Partial<Record<Stage, readonly string[]>>;
  /** Markdown starter content keyed by document slug. Short on purpose. */
  documentSeeds: Partial<Record<DocumentSlug, string>>;
}

// ── 1. SaaS B2B ──────────────────────────────────────────────────────────────

const SAAS_B2B: WorkspaceTemplate = {
  slug: 'saas-b2b',
  name: 'B2B SaaS',
  blurb: 'Subscription software you sell to other companies. Trial, demo, close.',
  highlights: ['Subscription pricing', 'Outbound GTM', 'Demo-led', 'Stripe + Slack'],
  mission: {
    oneLinePitch: 'Software that saves teams hours every week.',
    targetCustomer: 'Operations leads at 50–500 person companies.',
    productDescription:
      'A SaaS tool with a free trial, a pricing page, a demo flow, and a paid subscription.',
  },
  coreMemorySeeds: {
    pricing_model: 'subscription',
    gtm_motion: 'outbound',
    business_type: 'b2b-saas',
    revenue_target: 'MRR',
  },
  recommendedIntegrations: [
    'github',
    'vercel',
    'stripe',
    'slack',
    'posthog',
    'linear',
    'loops',
  ],
  extraGates: {
    idea: ['Define your ICP'],
    initial: ['Set up free trial'],
    selling: ['Publish pricing page', 'First paying logo'],
  },
  documentSeeds: {
    'brand-kit': `# Brand kit

Voice: confident, calm, builder-to-builder.
Audience: ops leads at growing companies who hate manual work.
Tone words: precise, dry, useful.

## Palette
- Primary: deep navy
- Accent: signal green
- Neutral: warm grey
`,
    'sales-plan': `# Sales plan

## Motion
Outbound + inbound demos. ICP-led. No spray-and-pray.

## ICP
- Operations leads at 50–500 person companies.
- Pain: spreadsheets, manual hand-offs, no audit trail.

## Funnel
1. Outbound email → demo booked
2. 30-min demo → trial
3. Trial → contract

## Pricing
Per-seat monthly subscription. Annual discount.
`,
    'marketing-plan': `# Marketing plan

## Channels
- Outbound email (primary)
- Founder LinkedIn (weekly)
- One pillar blog post per month

## Content
Builder-to-builder, no "thought leadership". Show the product.

## KPIs
Demos booked, trial conversion, logos closed.
`,
  },
};

// ── 2. Consumer marketplace ──────────────────────────────────────────────────

const CONSUMER_MARKETPLACE: WorkspaceTemplate = {
  slug: 'consumer-marketplace',
  name: 'Consumer marketplace',
  blurb: 'Two-sided market. Supply on one side, demand on the other. Liquidity is the only metric.',
  highlights: ['Take-rate pricing', 'Community-led', 'Two-sided', 'Liquidity-first'],
  mission: {
    oneLinePitch: 'A marketplace that matches people who have X with people who need X.',
    targetCustomer: 'Consumers in an underserved category.',
    productDescription:
      'A two-sided marketplace. Supply lists, demand books, we take a cut.',
  },
  coreMemorySeeds: {
    pricing_model: 'take-rate',
    gtm_motion: 'community',
    business_type: 'consumer-marketplace',
    revenue_target: 'GMV',
  },
  recommendedIntegrations: ['vercel', 'stripe', 'twitter', 'posthog', 'replicate'],
  extraGates: {
    idea: ['Find your first 10 supply-side users'],
    initial: ['Define liquidity threshold'],
  },
  documentSeeds: {
    'marketing-plan': `# Marketing plan

## Supply acquisition
Hand-recruit the first 100 suppliers. No ads.

## Demand acquisition
Community channels first. Reddit, Discord, niche Twitter.

## Cold-start
Pick one geography or category. Saturate before you expand.
`,
    'business-model-canvas': `# Business model canvas

## Customer segments
- Supply: people with the thing
- Demand: people who want the thing

## Value proposition
- Supply: easy listings, fair payout, no chargebacks
- Demand: trust, selection, price

## Channels
Community, word of mouth, paid only after liquidity.

## Revenue
Take rate on every completed transaction.

## Key metric
Liquidity: % of listings that convert in 7 days.
`,
  },
};

// ── 3. Agency / services ─────────────────────────────────────────────────────

const B2B_AGENCY: WorkspaceTemplate = {
  slug: 'b2b-agency',
  name: 'Agency / services',
  blurb: 'You sell work, not software. Repeatable offer, project pipeline, referrals.',
  highlights: ['Project pricing', 'Referral GTM', 'Service-first', 'Pipeline-led'],
  mission: {
    oneLinePitch: 'A specialist agency that delivers one thing exceptionally well.',
    targetCustomer: 'Companies that need expert help with a single, high-leverage problem.',
    productDescription:
      'A productized service. One repeatable offer. Fixed scope, fixed price.',
  },
  coreMemorySeeds: {
    pricing_model: 'project',
    gtm_motion: 'referral',
    business_type: 'agency',
    revenue_target: 'booked-revenue',
  },
  recommendedIntegrations: ['linear', 'slack', 'notion', 'stripe'],
  extraGates: {
    idea: ['Define your service offering'],
    selling: ['First paying client'],
  },
  documentSeeds: {
    'sales-plan': `# Sales plan

## Offer
One productized service. Fixed scope. Fixed price. Two-week turnaround.

## Pipeline
- Referrals from existing clients (primary)
- Founder network
- One inbound channel (newsletter or podcast)

## Pricing
Project-based. Tiered. Never hourly.
`,
    'executive-summary': `# Executive summary

We deliver one specialist service to companies that need expert help.

## What we do
[Your one productized offer.]

## Who we serve
[Your ICP.]

## How we make money
Fixed-price projects. Referrals.

## Why us
Depth, not breadth. We do one thing better than anyone.
`,
  },
};

// ── 4. Open-source first ─────────────────────────────────────────────────────

const OPEN_SOURCE: WorkspaceTemplate = {
  slug: 'open-source',
  name: 'Open-source first',
  blurb: 'Build in public. Stars first, revenue second. The community is the moat.',
  highlights: ['Premium cloud', 'Developer-led', 'GitHub-first', 'Community moat'],
  mission: {
    oneLinePitch: 'An open-source project that developers love, with a premium cloud offering.',
    targetCustomer: 'Developers who would self-host but eventually pay for managed.',
    productDescription:
      'An open-source codebase with a hosted, paid tier for teams that want managed infrastructure.',
  },
  coreMemorySeeds: {
    pricing_model: 'premium-cloud',
    gtm_motion: 'developer-led',
    business_type: 'open-source',
    revenue_target: 'cloud-MRR',
  },
  recommendedIntegrations: ['github', 'vercel', 'twitter', 'linear', 'posthog'],
  extraGates: {
    initial: ['Set up community Discord', 'First external contributor'],
    selling: ['1000 stars'],
  },
  documentSeeds: {
    'business-plan': `# Business plan

## Model
Open core. Free self-hosted. Paid managed cloud.

## Distribution
GitHub stars → trials → cloud conversions.

## Community
Discord for contributors. Public roadmap. Weekly office hours.

## Revenue
Cloud subscriptions. Eventually: enterprise SSO + SLAs.
`,
    'pitch-deck': `# Pitch deck

## Slide 1 — One line
[Your project] is the open-source way to [solve X].

## Slide 2 — Problem
Devs do X with broken tools or hand-rolled scripts.

## Slide 3 — Solution
A single, well-designed library, free to use, hosted if you want managed.

## Slide 4 — Traction
GitHub stars, contributors, cloud sign-ups.

## Slide 5 — Why now
[The shift that makes this possible now.]
`,
  },
};

// ── 5. Physical product ──────────────────────────────────────────────────────

const PHYSICAL_PRODUCT: WorkspaceTemplate = {
  slug: 'physical-product',
  name: 'Physical product',
  blurb: 'You ship atoms, not bits. Per-unit margin, inventory, and a manufacturing partner.',
  highlights: ['Per-unit pricing', 'Direct-to-consumer', 'Inventory matters', 'Brand-led'],
  mission: {
    oneLinePitch: 'A physical product sold direct to the people who feel the problem most.',
    targetCustomer: 'Consumers who have tried the alternatives and want something better-designed.',
    productDescription:
      'A physical good manufactured in batches, sold direct via our own storefront.',
  },
  coreMemorySeeds: {
    pricing_model: 'per-unit',
    gtm_motion: 'direct-to-consumer',
    business_type: 'physical-product',
    revenue_target: 'units-shipped',
  },
  recommendedIntegrations: ['stripe', 'twitter', 'posthog', 'resend'],
  extraGates: {
    initial: ['Manufacturing partner'],
    selling: ['Inventory tracking', 'First 100 units sold'],
  },
  documentSeeds: {
    'business-model-canvas': `# Business model canvas

## Customer segments
Consumers who have tried the alternatives and want better design or materials.

## Value proposition
A product that does one thing beautifully. No compromises.

## Channels
Own storefront. Founder social. No marketplaces in v1.

## Cost structure
COGS, shipping, returns, manufacturing minimum order.

## Key resource
Manufacturing partner who actually answers the phone.
`,
    'business-plan': `# Business plan

## Product
[One sentence — what is it and what does it replace.]

## Unit economics
- COGS per unit: $X
- Retail price: $Y
- Gross margin: Z%
- Shipping per unit: $W

## Inventory
Order in batches. Hold 60–90 days of supply.

## Launch
Pre-orders first. Don't manufacture until you have demand.

## Risks
Manufacturing slip. Shipping cost spikes. Returns over 5%.
`,
  },
};

// ── Exports ──────────────────────────────────────────────────────────────────

export const WORKSPACE_TEMPLATES: readonly WorkspaceTemplate[] = [
  SAAS_B2B,
  CONSUMER_MARKETPLACE,
  B2B_AGENCY,
  OPEN_SOURCE,
  PHYSICAL_PRODUCT,
] as const;

export const WORKSPACE_TEMPLATE_SLUGS: readonly WorkspaceTemplateSlug[] =
  WORKSPACE_TEMPLATES.map((t) => t.slug);

export function getWorkspaceTemplate(
  slug: string,
): WorkspaceTemplate | null {
  return WORKSPACE_TEMPLATES.find((t) => t.slug === slug) ?? null;
}

export function isWorkspaceTemplateSlug(s: unknown): s is WorkspaceTemplateSlug {
  return (
    typeof s === 'string' &&
    (WORKSPACE_TEMPLATE_SLUGS as readonly string[]).includes(s)
  );
}
