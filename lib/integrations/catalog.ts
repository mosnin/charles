/**
 * The catalog of third-party apps Charles can connect to. One entry per app
 * the founder sees in the integrations panel.
 *
 * Curation principles:
 *   - Ship with what a founder actually needs on day one. No 80-app wall.
 *   - comingSoon: false only for integrations that are fully wired today.
 *   - composioKey only where Composio has a real, tested toolkit.
 *   - Max 30 entries total — cut anything that adds noise without value.
 *
 * The `toolkit` slug is what Composio knows the app as. We pass it
 * verbatim to `composio.toolkits.get(slug)` and to `composio.tools.list({
 * toolkits: [slug] })`. Don't change a slug without verifying against
 * Composio's live catalog.
 */

export type IntegrationCategory =
  | 'engineering'
  | 'domains'
  | 'payments'
  | 'email-messaging'
  | 'marketing-social'
  | 'ai-generative'
  | 'docs-files';

export interface IntegrationApp {
  /** Canonical slug — also the Composio toolkit slug where composioKey is set. */
  toolkit: string;
  /** Display name shown to the founder. */
  name: string;
  /** One-line description. Founder language, no marketing fluff. */
  blurb: string;
  category: IntegrationCategory;
  /**
   * Promoted apps appear at the top of the integrations panel. Non-
   * promoted apps live in a "More" section. Default true.
   */
  promoted?: boolean;
  /**
   * True for apps we surface but don't yet have a live OAuth path for.
   * The UI renders a disabled "Coming soon" pill. The connect route 501s
   * the slug. No IntegrationConnection row → these never reach the agent.
   */
  comingSoon?: boolean;
  /**
   * Composio toolkit key — only set where Composio has a real integration.
   * When set, OAuth is handled through Composio's connect flow.
   * When absent, the adapter is custom (e.g. direct GitHub OAuth, Stripe keys).
   */
  composioKey?: string;
}

/**
 * Slugs that exist in the catalog but have no live OAuth path yet.
 * The connect route 501s these. Single source of truth — catalog and route
 * can't drift.
 */
export const COMING_SOON_TOOLKITS = new Set<string>([
  // Engineering
  'gitlab',
  'vercel',
  'supabase',
  'sentry',
  // Domains
  'vercel_domains',
  // Payments
  'lemonsqueezy',
  'paddle',
  // Email / Messaging
  'discord',
  // Marketing / Social
  'beehiiv',
  'plausible',
  // AI / Generative
  'anthropic',
  'elevenlabs',
  'figma',
  // Docs / Files
  'google_drive',
  'dropbox',
]);

/**
 * Catalog ordering matters — this is the order the founder sees them.
 * Grouped by category, ordered by day-one utility within each group.
 */
export const INTEGRATIONS: IntegrationApp[] = [
  // ── Engineering ──────────────────────────────────────────────────────
  {
    toolkit: 'github',
    name: 'GitHub',
    blurb: 'Create repos, push files, and open PRs from Charles.',
    category: 'engineering',
    promoted: true,
    composioKey: 'github',
  },
  {
    toolkit: 'linear',
    name: 'Linear',
    blurb: 'Create and update issues as Charles ships work.',
    category: 'engineering',
    promoted: true,
    composioKey: 'linear',
  },
  {
    toolkit: 'gitlab',
    name: 'GitLab',
    blurb: 'Same as GitHub, for GitLab-hosted repos.',
    category: 'engineering',
    comingSoon: true,
  },
  {
    toolkit: 'vercel',
    name: 'Vercel',
    blurb: 'Deploy and manage projects.',
    category: 'engineering',
    comingSoon: true,
  },
  {
    toolkit: 'supabase',
    name: 'Supabase',
    blurb: 'Run migrations and inspect your database.',
    category: 'engineering',
    comingSoon: true,
  },
  {
    toolkit: 'sentry',
    name: 'Sentry',
    blurb: 'Surface errors and resolve issues.',
    category: 'engineering',
    comingSoon: true,
  },

  // ── Payments ─────────────────────────────────────────────────────────
  {
    toolkit: 'stripe',
    name: 'Stripe',
    blurb: 'Read revenue, create payment links, manage subscriptions.',
    category: 'payments',
    promoted: true,
  },
  {
    toolkit: 'lemonsqueezy',
    name: 'Lemon Squeezy',
    blurb: 'Merchant of record — products, checkouts, payouts.',
    category: 'payments',
    comingSoon: true,
  },
  {
    toolkit: 'paddle',
    name: 'Paddle',
    blurb: 'Same, for Paddle.',
    category: 'payments',
    comingSoon: true,
  },

  // ── Email / Messaging ─────────────────────────────────────────────────
  {
    toolkit: 'resend',
    name: 'Resend',
    blurb: 'Send transactional and marketing email.',
    category: 'email-messaging',
    promoted: true,
  },
  {
    toolkit: 'slack',
    name: 'Slack',
    blurb: 'Post updates and alerts to your team channel.',
    category: 'email-messaging',
    promoted: true,
    composioKey: 'slack',
  },
  {
    toolkit: 'loops',
    name: 'Loops',
    blurb: 'Lifecycle email for SaaS — events, sequences, broadcasts.',
    category: 'email-messaging',
  },
  {
    toolkit: 'discord',
    name: 'Discord',
    blurb: 'Post updates to a Discord server.',
    category: 'email-messaging',
    comingSoon: true,
  },

  // ── Marketing / Social ────────────────────────────────────────────────
  {
    toolkit: 'twitter',
    name: 'X (Twitter)',
    blurb: 'Draft and post from your company account.',
    category: 'marketing-social',
    promoted: true,
  },
  {
    toolkit: 'posthog',
    name: 'PostHog',
    blurb: 'Query product analytics and funnels.',
    category: 'marketing-social',
    promoted: true,
  },
  {
    toolkit: 'linkedin',
    name: 'LinkedIn',
    blurb: 'Post updates to your company page.',
    category: 'marketing-social',
  },
  {
    toolkit: 'beehiiv',
    name: 'Beehiiv',
    blurb: 'Send newsletters and grow your audience.',
    category: 'marketing-social',
    comingSoon: true,
  },
  {
    toolkit: 'plausible',
    name: 'Plausible',
    blurb: 'Privacy-friendly web analytics.',
    category: 'marketing-social',
    comingSoon: true,
  },

  // ── AI / Generative ───────────────────────────────────────────────────
  {
    toolkit: 'openai',
    name: 'OpenAI',
    blurb: 'Call GPT models and manage fine-tunes.',
    category: 'ai-generative',
  },
  {
    toolkit: 'anthropic',
    name: 'Anthropic',
    blurb: 'Call Claude models directly.',
    category: 'ai-generative',
    comingSoon: true,
  },
  {
    toolkit: 'replicate',
    name: 'Replicate',
    blurb: 'Run image, video, and audio models.',
    category: 'ai-generative',
  },
  {
    toolkit: 'elevenlabs',
    name: 'ElevenLabs',
    blurb: 'Generate voice-overs and audio clips.',
    category: 'ai-generative',
    comingSoon: true,
  },
  {
    toolkit: 'figma',
    name: 'Figma',
    blurb: 'Read designs and export assets.',
    category: 'ai-generative',
    comingSoon: true,
  },

  // ── Domains ───────────────────────────────────────────────────────────
  {
    toolkit: 'cloudflare_dns',
    name: 'Cloudflare DNS',
    blurb: 'Manage DNS records and protect your domains.',
    category: 'domains',
  },
  {
    toolkit: 'vercel_domains',
    name: 'Vercel Domains',
    blurb: 'Register and manage domains from your Vercel dashboard.',
    category: 'domains',
    comingSoon: true,
  },

  // ── Docs / Files ──────────────────────────────────────────────────────
  {
    toolkit: 'notion',
    name: 'Notion',
    blurb: 'Read and write pages in your workspace.',
    category: 'docs-files',
    promoted: true,
    composioKey: 'notion',
  },
  {
    toolkit: 'google_drive',
    name: 'Google Drive',
    blurb: 'Read and upload files to Drive.',
    category: 'docs-files',
    composioKey: 'googledrive',
    comingSoon: true,
  },
  {
    toolkit: 'dropbox',
    name: 'Dropbox',
    blurb: 'Same, for Dropbox.',
    category: 'docs-files',
    comingSoon: true,
  },
];

/** Look up by slug. Returns undefined for unknown toolkits. */
export function findIntegration(toolkit: string): IntegrationApp | undefined {
  return INTEGRATIONS.find((a) => a.toolkit === toolkit);
}

/** All toolkit slugs Composio knows about for our app. */
export function allToolkitSlugs(): string[] {
  return INTEGRATIONS.map((a) => a.toolkit);
}

/** Toolkits we surface in the Connect panel's primary section. */
export function promotedIntegrations(): IntegrationApp[] {
  return INTEGRATIONS.filter((a) => a.promoted);
}

/** Group by category for the integrations panel. */
export function integrationsByCategory(): Record<IntegrationCategory, IntegrationApp[]> {
  const grouped = {} as Record<IntegrationCategory, IntegrationApp[]>;
  for (const app of INTEGRATIONS) {
    if (!grouped[app.category]) grouped[app.category] = [];
    grouped[app.category].push(app);
  }
  return grouped;
}
