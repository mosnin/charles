import { notFound, redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import { getSpaceFromSlug } from '@/lib/space';
import { supabase } from '@/lib/supabase';
import { CharlesWorkspace } from '@/components/charles/charles-workspace';
import type { Conversation } from '@/lib/types';
import type { MessageBlock } from '@/lib/ai-tools/blocks';

// Force dynamic rendering — the page reads searchParams to pick which
// conversation to hydrate, and we need a fresh server render on every
// query-string change. Without this, Next.js can serve a cached render
// across navigations and the workspace ends up with stale initialMessages.
export const dynamic = 'force-dynamic';

export default async function ChatPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ q?: string; tab?: string; prefill?: string; conversationId?: string }>;
}) {
  const { slug } = await params;
  const { q, tab, prefill, conversationId: urlConversationId } = await searchParams;
  const initialInput = typeof q === 'string' && q.trim() ? q.trim() : undefined;
  // `prefill` populates the composer but does NOT auto-send — the founder
  // finishes the sentence themselves. Used by shortcuts elsewhere in the
  // workspace. Distinct from `q`.
  const initialPrefill = typeof prefill === 'string' && prefill.length > 0 ? prefill : undefined;
  const view = tab === 'settings' ? 'settings' : 'workspace';

  const { userId } = await auth();
  // TODO(charles): phase 4 — rename `/login/realtor` to `/login` once auth routes are flattened.
  if (!userId) redirect('/login/realtor');

  const space = await getSpaceFromSlug(slug);
  if (!space) notFound();

  // Verify the authenticated user owns this space
  const { data: spaceOwner } = await supabase
    .from('User')
    .select('id')
    .eq('clerkId', userId)
    .eq('id', space.ownerId)
    .maybeSingle();
  if (!spaceOwner) notFound();

  // Load conversations for this space
  let conversations: Conversation[] = [];
  let initialMessages: { role: 'user' | 'assistant'; content: string; blocks?: MessageBlock[] | null }[] = [];
  let initialConversationId: string | null = null;

  try {
    const { data: convData } = await supabase
      .from('Conversation')
      .select('*')
      .eq('spaceId', space.id)
      .not('title', 'like', '[BROKERAGE_CHAT]%')
      .order('updatedAt', { ascending: false })
      .limit(50);
    conversations = (convData ?? []) as Conversation[];

    // Pick which conversation to hydrate. URL is the source of truth.
    // No URL param → show the new-chat screen (targetConvId = null).
    const targetConvId = urlConversationId ?? null;
    if (targetConvId) {
      initialConversationId = targetConvId;
      const { data: msgData } = await supabase
        .from('Message')
        .select('role, content, blocks')
        .eq('conversationId', targetConvId)
        .order('createdAt', { ascending: true })
        .limit(50);
      initialMessages = ((msgData ?? []) as { role: string; content: string; blocks: MessageBlock[] | null }[]).map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
        blocks: m.blocks,
      }));
    }
  } catch {
    // fall back to empty state
  }

  return (
    <div className="flex h-full flex-col">
      <CharlesWorkspace
        slug={slug}
        view={view}
        initialMessages={initialMessages}
        initialConversations={conversations}
        initialConversationId={initialConversationId}
        initialInput={initialInput}
        initialPrefill={initialPrefill}
      />
    </div>
  );
}
