/**
 * Design › Brand kit — read-only preview of the brand-kit Document.
 *
 * The brand kit is authored in the wizard at /brand. This tab shows the
 * current markdown inline so the founder can see it without leaving the
 * dept page; for edits we link out.
 */

import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { BODY, BODY_MUTED } from '@/lib/typography';
import { EmptyState } from './empty-state';

interface Props {
  spaceId: string;
  spaceSlug: string;
}

export async function DesignBrand({ spaceId, spaceSlug }: Props) {
  let content = '';
  try {
    const { data } = await supabase
      .from('Document')
      .select('content')
      .eq('spaceId', spaceId)
      .eq('slug', 'brand-kit')
      .maybeSingle();
    content = (data as { content?: string } | null)?.content ?? '';
  } catch {
    content = '';
  }

  if (!content.trim()) {
    return (
      <EmptyState
        title="No brand kit yet."
        hint="Run the brand builder to set your logo, colors, and voice."
        cta={{ label: 'Open in brand builder', href: `/s/${spaceSlug}/brand` }}
      />
    );
  }

  return (
    <section className="space-y-4">
      <article className="rounded-2xl border border-slate-200 bg-white px-6 py-5 max-h-[560px] overflow-auto">
        <pre className={`${BODY} whitespace-pre-wrap font-sans leading-6`}>
          {content}
        </pre>
      </article>
      <p className={BODY_MUTED}>
        <Link
          href={`/s/${spaceSlug}/brand`}
          className="underline underline-offset-4 hover:text-slate-900"
        >
          Open in brand builder
        </Link>
      </p>
    </section>
  );
}
