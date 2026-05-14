/**
 * /s/[slug]/documents — the founder's desk.
 *
 * Nine documents, four groups. Every group earns its purpose; every card
 * earns its line of copy. The page reads as a quiet workspace, not a
 * dashboard: a small page header, four sections, two-column grid on
 * desktop. Hover lifts the card a hair — that's the only motion.
 *
 * Empty rows still render as "Not started." We never hide a missing doc;
 * the absence is the prompt.
 */

import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import { ArrowUpRight } from 'lucide-react';
import { getSpaceFromSlug } from '@/lib/space';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import {
  H1,
  H2,
  TITLE_FONT,
  BODY_MUTED,
  SECTION_LABEL,
  PAGE_RHYTHM,
  READING_MAX,
} from '@/lib/typography';
import {
  DOCUMENTS,
  GROUP_BLURBS,
  GROUP_LABELS,
  GROUP_ORDER,
  documentsByGroup,
  type DocumentDef,
  type DocumentSlug,
} from '@/lib/documents/catalog';

interface DocumentRow {
  slug: DocumentSlug;
  content: string | null;
  updatedAt: string | null;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default async function DocumentsIndexPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { userId } = await auth();
  if (!userId) redirect('/sign-in');

  const space = await getSpaceFromSlug(slug);
  if (!space) notFound();

  // Fetch existing rows. Missing rows are fine — the catalog drives the
  // shape of the page, the DB only contributes "edited" state.
  const { data } = await supabase
    .from('Document')
    .select('slug, content, updatedAt')
    .eq('spaceId', space.id);

  const rows = (data ?? []) as DocumentRow[];
  const bySlug = new Map<string, DocumentRow>(rows.map((r) => [r.slug, r]));

  const grouped = documentsByGroup();

  return (
    <div className={cn(PAGE_RHYTHM, READING_MAX)}>
      {/* Page header — quiet, one sentence under the title. */}
      <header className="space-y-1.5">
        <p className={BODY_MUTED}>Documents.</p>
        <h1 className={H1} style={TITLE_FONT}>
          Documents
        </h1>
        <p className={BODY_MUTED}>
          Your company in writing. Nine documents, four groups.
        </p>
      </header>

      {/* Four groups, in catalog order. Each section is its own quiet block. */}
      {GROUP_ORDER.map((group) => {
        const docs = grouped[group];
        if (docs.length === 0) return null;
        return (
          <section key={group} className="space-y-5">
            <div className="space-y-1.5">
              <p className={SECTION_LABEL}>{GROUP_LABELS[group]}</p>
              <h2 className={H2}>{GROUP_BLURBS[group]}</h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {docs.map((doc) => (
                <DocumentCard
                  key={doc.slug}
                  slug={slug}
                  doc={doc}
                  row={bySlug.get(doc.slug)}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function DocumentCard({
  slug,
  doc,
  row,
}: {
  slug: string;
  doc: DocumentDef;
  row: DocumentRow | undefined;
}) {
  const hasContent = (row?.content ?? '').trim().length > 0;
  const statusLine =
    hasContent && row?.updatedAt
      ? `Edited ${relativeTime(row.updatedAt)}`
      : 'Not started';

  return (
    <Link
      href={`/s/${slug}/documents/${doc.slug}`}
      className={cn(
        'group relative block rounded-xl border border-border/70 bg-card',
        'p-5 transition-all duration-150 ease-out',
        'hover:border-foreground/30 hover:-translate-y-px',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1.5">
          <p className="text-[15px] font-semibold text-foreground leading-tight">
            {doc.title}
          </p>
          <p className={cn(BODY_MUTED, 'leading-snug')}>{doc.blurb}</p>
        </div>
        <ArrowUpRight
          size={16}
          strokeWidth={1.75}
          className={cn(
            'flex-shrink-0 text-muted-foreground/40',
            'transition-colors duration-150',
            'group-hover:text-foreground',
          )}
          aria-hidden
        />
      </div>
      <p className="mt-4 text-xs tabular-nums text-muted-foreground/70">
        {statusLine}
      </p>
    </Link>
  );
}
