/**
 * /s/[slug]/templates — workspace template picker.
 *
 * Five opinionated starting points. The founder picks one, we seed mission
 * fields, core memory, extra gates, and document starter content. We never
 * overwrite anything the founder already set.
 *
 * The page is intentionally small — title, paragraph, five cards. Nothing
 * else. The cards do the work.
 */

import { notFound, redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import type { Metadata } from 'next';
import { getSpaceFromSlug } from '@/lib/space';
import { supabase } from '@/lib/supabase';
import {
  H1,
  TITLE_FONT,
  BODY_MUTED,
  PAGE_RHYTHM,
  READING_MAX,
} from '@/lib/typography';
import { WORKSPACE_TEMPLATES } from '@/lib/workspace-templates/catalog';
import { findIntegration } from '@/lib/integrations/catalog';
import { TemplateCard } from './template-card';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  return { title: `Templates — ${slug}` };
}

export default async function TemplatesPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { userId } = await auth();
  if (!userId) redirect('/login');

  const space = await getSpaceFromSlug(slug);
  if (!space) notFound();

  const { data: spaceOwner } = await supabase
    .from('User')
    .select('id')
    .eq('clerkId', userId)
    .eq('id', space.ownerId)
    .maybeSingle();
  if (!spaceOwner) notFound();

  return (
    <div className={PAGE_RHYTHM}>
      <header className={`space-y-2 ${READING_MAX}`}>
        <p className={BODY_MUTED}>Templates.</p>
        <h1 className={H1} style={TITLE_FONT}>
          Workspace templates
        </h1>
        <p className={BODY_MUTED}>
          Pre-filled starting points. Pick one to seed your mission, gates, and
          documents. Already-set values stay yours.
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        {WORKSPACE_TEMPLATES.map((t) => {
          const integrations = t.recommendedIntegrations
            .map((toolkit) => findIntegration(toolkit))
            .filter((x): x is NonNullable<typeof x> => Boolean(x))
            .map((x) => ({ toolkit: x.toolkit, name: x.name }));
          return (
            <TemplateCard
              key={t.slug}
              slug={t.slug}
              name={t.name}
              blurb={t.blurb}
              highlights={t.highlights}
              integrations={integrations}
              spaceSlug={slug}
            />
          );
        })}
      </div>
    </div>
  );
}
