/**
 * /s/[slug]/agents/templates/new — bare-bones creation.
 *
 * Two decisions: name it, pick a trigger. Then the founder is in the builder.
 * No second screen. No checklist. The actual configuration is the builder
 * itself — this page is just the door.
 */

import { notFound, redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import { getSpaceFromSlug } from '@/lib/space';
import {
  H1,
  TITLE_FONT,
  BODY_MUTED,
  PAGE_RHYTHM,
  READING_MAX,
} from '@/lib/typography';
import { cn } from '@/lib/utils';
import { NewTemplateForm } from '@/components/canvas/new-template-form';

export default async function NewTemplatePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { userId } = await auth();
  if (!userId) redirect('/sign-in');

  const space = await getSpaceFromSlug(slug);
  if (!space) notFound();

  return (
    <div className={cn(PAGE_RHYTHM, READING_MAX, 'mx-auto px-6 py-12')}>
      <header className="space-y-2">
        <h1 className={H1} style={TITLE_FONT}>
          New template
        </h1>
        <p className={BODY_MUTED}>Name the task agent. Pick what kicks it off.</p>
      </header>

      <NewTemplateForm spaceSlug={space.slug} />
    </div>
  );
}
