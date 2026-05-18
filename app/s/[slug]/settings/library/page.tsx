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
import { LibraryTab } from '@/components/canvas/library-tab';

export default async function LibrarySettingsPage({
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
    <div className={`${PAGE_RHYTHM} ${READING_MAX}`}>
      <header className="space-y-1.5">
        <p className={BODY_MUTED}>Library.</p>
        <h1 className={H1} style={TITLE_FONT}>
          Reference material
        </h1>
        <p className={BODY_MUTED}>
          Docs, screenshots, brand assets. Charles uses these as context when relevant.
        </p>
      </header>
      <section className="pt-2">
        <LibraryTab />
      </section>
    </div>
  );
}
