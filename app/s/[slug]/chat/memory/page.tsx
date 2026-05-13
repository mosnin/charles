import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { auth } from '@clerk/nextjs/server';
import { getSpaceFromSlug } from '@/lib/space';
import { supabase } from '@/lib/supabase';
import { MemoryFeed } from '@/components/chippi/memory-feed';
import { PageTitle } from '@/components/ui/page-title';

export const metadata = { title: 'What I remember — Charles' };

export default async function ChatMemoryPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { userId } = await auth();
  if (!userId) redirect('/login/realtor');

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
    <div className="max-w-3xl mx-auto space-y-6 py-2">
      <Link
        href={`/s/${slug}/chat`}
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft size={12} />
        Back to Charles
      </Link>
      <PageTitle label="Charles." subtitle="Everything I've learned about you and your work. Delete anything I got wrong — I'll re-learn it if it comes up again.">
        What I remember
      </PageTitle>

      <MemoryFeed slug={slug} />
    </div>
  );
}
