/**
 * Workspace documents catalog — the single source of truth for the nine
 * documents every Charles workspace owns. Order matters: it drives both the
 * sidebar order and the index-page grouping. Keep this file in lockstep with
 * the CHECK constraint in supabase/migrations/20260606000008_charles_documents.sql.
 *
 * Four groups, nine docs:
 *   Mission   — who you are and why you exist           (2 docs)
 *   Identity  — how the world sees you                  (2 docs)
 *   Strategy  — how it works                            (2 docs)
 *   Execution — what ships                              (3 docs)
 */

export type DocumentSlug =
  | 'executive-summary'
  | 'business-plan'
  | 'brand-kit'
  | 'pitch-deck'
  | 'business-model-canvas'
  | 'growth-blueprint'
  | 'product-prd'
  | 'sales-plan'
  | 'marketing-plan';

export type DocumentGroup = 'mission' | 'identity' | 'strategy' | 'execution';

export interface DocumentDef {
  slug: DocumentSlug;
  title: string;
  /** One-liner that ships in the UI. The only marketing copy in the system. */
  blurb: string;
  group: DocumentGroup;
}

export const GROUP_LABELS: Record<DocumentGroup, string> = {
  mission: 'Mission',
  identity: 'Identity',
  strategy: 'Strategy',
  execution: 'Execution',
};

export const GROUP_BLURBS: Record<DocumentGroup, string> = {
  mission: 'Who you are and why you exist.',
  identity: 'How the world sees you.',
  strategy: 'How it works.',
  execution: 'What ships.',
};

export const GROUP_ORDER: readonly DocumentGroup[] = [
  'mission',
  'identity',
  'strategy',
  'execution',
];

export const DOCUMENTS: readonly DocumentDef[] = [
  // Mission
  {
    slug: 'executive-summary',
    title: 'Executive summary',
    blurb: "The one-page answer to 'what does this do and who's it for.'",
    group: 'mission',
  },
  {
    slug: 'business-plan',
    title: 'Business plan',
    blurb: 'The long version: market, model, roadmap, risks.',
    group: 'mission',
  },
  // Identity
  {
    slug: 'brand-kit',
    title: 'Brand kit',
    blurb: 'Voice, palette, type, logo. The rules behind every surface.',
    group: 'identity',
  },
  {
    slug: 'pitch-deck',
    title: 'Pitch deck',
    blurb: 'The 10–15 slides that raise the round.',
    group: 'identity',
  },
  // Strategy
  {
    slug: 'business-model-canvas',
    title: 'Business model canvas',
    blurb: 'Nine blocks: customer, value, channels, money.',
    group: 'strategy',
  },
  {
    slug: 'growth-blueprint',
    title: 'Growth blueprint',
    blurb: 'How acquisition compounds month over month.',
    group: 'strategy',
  },
  // Execution
  {
    slug: 'product-prd',
    title: 'Product PRD',
    blurb: "What we're building, in builder-speak.",
    group: 'execution',
  },
  {
    slug: 'sales-plan',
    title: 'Sales plan',
    blurb: 'Who, how, when, and the words that win the deal.',
    group: 'execution',
  },
  {
    slug: 'marketing-plan',
    title: 'Marketing plan',
    blurb: 'Channels, calendar, content, KPIs.',
    group: 'execution',
  },
];

export const ALL_DOCUMENT_SLUGS: readonly DocumentSlug[] = DOCUMENTS.map(
  (d) => d.slug,
);

export function getDocument(slug: string): DocumentDef | undefined {
  return DOCUMENTS.find((d) => d.slug === slug);
}

export function documentsByGroup(): Record<DocumentGroup, readonly DocumentDef[]> {
  const result: Record<DocumentGroup, DocumentDef[]> = {
    mission: [],
    identity: [],
    strategy: [],
    execution: [],
  };
  for (const doc of DOCUMENTS) {
    result[doc.group].push(doc);
  }
  return result;
}
