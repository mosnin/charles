/**
 * /s/[slug]/chat/log — the voice debrief recorder.
 *
 * Server component: auth + space resolution. The actual recording UX
 * lives in <PostTourRecorder/>.
 *
 * TODO: This surface and its props (personId, dealId) are realtor-shaped
 * structural debt — the underlying recorder is being re-aimed at founder
 * voice debriefs in a follow-up pass. Names stay until that pass.
 */
import { notFound, redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import { getSpaceFromSlug } from '@/lib/space';
import { supabase } from '@/lib/supabase';
import { PostTourRecorder } from '@/components/chippi/post-tour-recorder';

export const metadata = { title: 'Voice debrief — Charles' };

export default async function PostTourPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  /** `?personId=` and `?dealId=` bias the proposal model toward a specific
   *  subject so the call/note/follow-up lands on the right record. The page
   *  works fine without them — the recorder UI doesn't change either way.
   *  TODO: rename these to founder-shaped subjects in a follow-up pass. */
  searchParams: Promise<{ personId?: string; dealId?: string }>;
}) {
  const { slug } = await params;
  const { personId, dealId } = await searchParams;
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
    <div className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center px-4 py-12">
      <PostTourRecorder
        slug={slug}
        personId={typeof personId === 'string' && personId ? personId : undefined}
        dealId={typeof dealId === 'string' && dealId ? dealId : undefined}
      />
    </div>
  );
}
