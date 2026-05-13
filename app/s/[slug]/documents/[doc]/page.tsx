/**
 * /s/[slug]/documents/[doc] — the document editor surface.
 *
 * One screen, three modes: Edit (rich text), Markdown (raw source, copyable),
 * PDF (print-ready preview). The mode is driven by ?mode=edit|markdown|pdf —
 * just URL state, no client store, no tabs framework. Default is edit.
 *
 * The page is a calm reading column. The blurb sets context, the title is the
 * subject, the three pills shift the lens. No toolbar chrome by default; the
 * editor teaches itself with keyboard shortcuts.
 *
 * Auth + space ownership are enforced upstream by the workspace layout, so
 * here we resolve the space + load the row (falling back to the catalog
 * default when no DB row exists).
 */

import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import { getSpaceFromSlug } from '@/lib/space';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import {
  H1,
  BODY_MUTED,
  TITLE_FONT,
  PAGE_RHYTHM,
} from '@/lib/typography';
import {
  getDocument,
  GROUP_LABELS,
} from '@/lib/documents/catalog';
import { EditMode } from './edit-mode';
import { MarkdownMode } from './markdown-mode';
import { PdfMode } from './pdf-mode';
import { DraftCard } from './draft-card';
import { MAX_PER_HOUR as PRD_MAX_PER_HOUR } from '@/app/api/documents/product-prd/generate/_buckets';

type Mode = 'edit' | 'markdown' | 'pdf';

function asMode(value: string | undefined): Mode {
  if (value === 'markdown' || value === 'pdf') return value;
  return 'edit';
}

export default async function DocumentPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; doc: string }>;
  searchParams: Promise<{ mode?: string }>;
}) {
  const [{ slug, doc: docSlug }, search] = await Promise.all([
    params,
    searchParams,
  ]);
  const { userId } = await auth();
  if (!userId) redirect('/login/realtor');

  const def = getDocument(docSlug);
  if (!def) notFound();

  const space = await getSpaceFromSlug(slug);
  if (!space) notFound();

  // Fall back to catalog default — never auto-create the row here.
  const { data: row } = await supabase
    .from('Document')
    .select('content, updatedAt')
    .eq('spaceId', space.id)
    .eq('slug', def.slug)
    .maybeSingle();

  const content =
    (row as { content?: string } | null)?.content ?? '';
  const mode: Mode = asMode(search?.mode);

  const groupLabel = GROUP_LABELS[def.group];

  return (
    <div className={PAGE_RHYTHM}>
      {/* ── Breadcrumb ─────────────────────────────────────────────── */}
      <nav
        aria-label="Breadcrumb"
        className={cn(BODY_MUTED, 'flex items-center gap-1.5 print:hidden')}
      >
        <Link
          href={`/s/${slug}/documents`}
          className="hover:text-foreground transition-colors duration-150"
        >
          Documents
        </Link>
        <span aria-hidden="true" className="text-muted-foreground/50">
          ›
        </span>
        <Link
          href={`/s/${slug}/documents#${def.group}`}
          className="hover:text-foreground transition-colors duration-150"
        >
          {groupLabel}
        </Link>
      </nav>

      {/* ── Title + blurb ──────────────────────────────────────────── */}
      <header className="space-y-1.5 print:hidden">
        <h1 className={H1} style={TITLE_FONT}>
          {def.title}
        </h1>
        <p className={cn(BODY_MUTED, 'max-w-xl')}>{def.blurb}</p>
      </header>

      {/* ── Mode pills ─────────────────────────────────────────────── */}
      <ModePills slug={slug} docSlug={def.slug} mode={mode} />

      {/* ── Draft affordance ───────────────────────────────────────── */}
      {mode === 'edit' &&
        def.slug === 'product-prd' &&
        content.trim().length < 100 && (
          <DraftCard
            endpoint="/api/documents/product-prd/generate"
            maxPerHour={PRD_MAX_PER_HOUR}
          />
        )}

      {/* ── Surface ────────────────────────────────────────────────── */}
      {mode === 'edit' && (
        <EditMode slug={def.slug} spaceId={space.id} initialContent={content} />
      )}
      {mode === 'markdown' && <MarkdownMode content={content} />}
      {mode === 'pdf' && <PdfMode title={def.title} content={content} />}
    </div>
  );
}

// ── Mode pills ─────────────────────────────────────────────────────────────

function ModePills({
  slug,
  docSlug,
  mode,
}: {
  slug: string;
  docSlug: string;
  mode: Mode;
}) {
  const base = `/s/${slug}/documents/${docSlug}`;
  const pills: ReadonlyArray<{ key: Mode; label: string; href: string }> = [
    { key: 'edit',     label: 'Edit',     href: base },
    { key: 'markdown', label: 'Markdown', href: `${base}?mode=markdown` },
    { key: 'pdf',      label: 'PDF',      href: `${base}?mode=pdf` },
  ];
  return (
    <div
      role="tablist"
      aria-label="View mode"
      className="flex items-center gap-1 print:hidden"
    >
      {pills.map((pill) => {
        const active = pill.key === mode;
        return (
          <Link
            key={pill.key}
            href={pill.href}
            role="tab"
            aria-selected={active}
            className={cn(
              'inline-flex h-8 items-center rounded-full px-3 text-sm transition-colors duration-150',
              active
                ? 'bg-foreground text-background'
                : 'text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground',
            )}
          >
            {pill.label}
          </Link>
        );
      })}
    </div>
  );
}
