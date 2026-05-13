/**
 * Pixel-art icon manifest for the cofounder.co-style canvas surfaces.
 *
 * Maps gate titles (from `lib/stages/catalog.ts`, lowercased + hyphenated)
 * and department slugs to SVG paths under `/public/icons/`. Each icon is a
 * single-color geometric pixel-art shape using `currentColor`, so callers
 * recolor with CSS (typically `text-foreground` or `text-canvas-accent`).
 *
 * Coverage: 9 stage gates + 6 departments shipped. Remaining gates fall
 * back to `idea.svg` and are explicitly marked TODO below so the agent
 * that ships the gate UI can see what's still missing.
 *
 * Do NOT import these as React components — they're consumed as image
 * sources (e.g. `<img src={iconForDepartment('engineering')} />`).
 */

/**
 * Gate title → svg path. Keys are the gate title from
 * `STAGES[*].gates`, lowercased with spaces → hyphens.
 */
export const STAGE_GATE_ICONS: Record<string, string> = {
  // ── Idea stage ─────────────────────────────────────────────────────────
  'define-your-company-in-one-sentence': '/icons/idea.svg',
  'identify-your-target-customer': '/icons/target-customer.svg',
  'connect-github': '/icons/github.svg',

  // ── Initial stage ──────────────────────────────────────────────────────
  'claim-a-domain-or-repo': '/icons/domain.svg',
  'capture-the-brand-voice': '/icons/voice.svg',
  // TODO: ship icon for surface (browser window pixel-art)
  'ship-a-first-product-surface': '/icons/idea.svg',

  // ── Identity stage ─────────────────────────────────────────────────────
  // TODO: ship icon for logo (palette / brush)
  'approve-the-logo-and-wordmark': '/icons/idea.svg',
  'publish-the-landing-page': '/icons/landing.svg',
  // TODO: ship icon for copy (page with lines)
  'review-the-core-copy': '/icons/idea.svg',
  // TODO: ship icon for social (link / chain)
  'claim-the-social-handles': '/icons/idea.svg',

  // ── Building stage ─────────────────────────────────────────────────────
  // TODO: ship icon for roadmap (kanban columns)
  'define-the-feature-roadmap': '/icons/idea.svg',
  'deploy-to-production': '/icons/deploy.svg',
  // TODO: ship icon for onboarding (door / arrow)
  'run-a-real-founder-onboarding': '/icons/idea.svg',

  // ── Selling stage ──────────────────────────────────────────────────────
  'turn-stripe-live': '/icons/stripe.svg',
  'publish-the-pricing-page': '/icons/pricing.svg',
  // TODO: ship icon for pitch (chart up)
  'test-the-sales-pitch': '/icons/idea.svg',
  // TODO: ship icon for customer (handshake)
  'land-the-first-paying-customer': '/icons/target-customer.svg',

  // ── Scaling stage ──────────────────────────────────────────────────────
  // TODO: ship icon for support (ticket / chat)
  'run-a-support-flow': '/icons/idea.svg',
  // TODO: ship icon for dashboard (gauge)
  'wire-the-ops-dashboard': '/icons/idea.svg',
  // TODO: ship icon for runway (fuel gauge / hourglass)
  'track-runway-weekly': '/icons/idea.svg',
};

/**
 * Department slug → svg path. The 6 departments are the orbiting nodes
 * around the centerpiece on the home canvas. All 6 ship in v1.
 */
export const DEPARTMENT_ICONS: Record<string, string> = {
  engineering: '/icons/dept-engineering.svg',
  sales: '/icons/dept-sales.svg',
  marketing: '/icons/dept-marketing.svg',
  design: '/icons/dept-design.svg',
  support: '/icons/dept-support.svg',
  ops_finance: '/icons/dept-ops-finance.svg',
};

/** Normalize a gate title to the manifest key. */
function normalizeGateKey(title: string): string {
  return title.toLowerCase().trim().replace(/\s+/g, '-');
}

/**
 * Resolve a gate title to an icon path. Unknown titles fall back to the
 * idea bulb so the UI never renders a broken-image glyph.
 */
export function iconForStageGate(title: string): string {
  const key = normalizeGateKey(title);
  return STAGE_GATE_ICONS[key] ?? '/icons/idea.svg';
}

/**
 * Resolve a department slug to an icon path. Unknown slugs fall back to
 * the engineering gear.
 */
export function iconForDepartment(slug: string): string {
  return DEPARTMENT_ICONS[slug] ?? '/icons/dept-engineering.svg';
}
