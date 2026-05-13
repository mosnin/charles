/**
 * /s/[slug]/stages/gates/[id] — per-gate split view.
 *
 * The left pane shape depends on the gate title — a doc-linked gate
 * ("Approve the logo and wordmark") renders the brand kit; a build gate
 * ("Deploy to production") renders the production URL iframe when one is
 * set in CoreMemory.
 *
 * Right pane is the per-gate TaskConversation.
 */

import { notFound, redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import { getSpaceFromSlug } from '@/lib/space';
import { supabase } from '@/lib/supabase';
import type { Stage } from '@/lib/stages/catalog';
import {
  breadcrumbForGate,
  subjectFromGate,
} from '@/lib/tasks/conversation-helpers';
import { TaskDetailLayout } from '@/components/canvas/task-detail-layout';
import type { TaskMessage } from '@/components/canvas/task-chat-thread';

interface StageGateRow {
  id: string;
  spaceId: string;
  stage: Stage;
  title: string;
  isComplete: boolean;
}

interface DocumentRow {
  slug: string;
  title: string;
  content: string;
}

interface ConversationRow {
  id: string;
}

interface MessageRow {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

interface CoreMemoryRow {
  slot: string;
  value: string | null;
}

/** Pick a Document slug for a gate title — best-effort keyword match. */
function documentSlugForGate(title: string): string | null {
  const t = title.toLowerCase();
  if (t.includes('logo') || t.includes('wordmark') || t.includes('brand')) return 'brand-kit';
  if (t.includes('pitch') || t.includes('deck')) return 'pitch-deck';
  if (t.includes('sales')) return 'sales-plan';
  if (t.includes('marketing')) return 'marketing-plan';
  if (t.includes('product') || t.includes('prd') || t.includes('feature')) return 'product-prd';
  if (t.includes('business plan') || t.includes('roadmap')) return 'business-plan';
  if (t.includes('summary') || t.includes('sentence')) return 'executive-summary';
  return null;
}

export default async function GateDetailPage({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const { slug, id } = await params;
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

  const { data: gateData, error: gateErr } = await supabase
    .from('StageGate')
    .select('id, spaceId, stage, title, isComplete')
    .eq('id', id)
    .eq('spaceId', space.id)
    .maybeSingle();
  if (gateErr || !gateData) notFound();
  const gate = gateData as StageGateRow;

  const docSlug = documentSlugForGate(gate.title);

  const [convResult, memResult, docResult] = await Promise.allSettled([
    supabase
      .from('TaskConversation')
      .select('id')
      .eq('spaceId', space.id)
      .eq('gateId', gate.id)
      .maybeSingle(),
    supabase
      .from('CoreMemory')
      .select('slot, value')
      .eq('spaceId', space.id)
      .eq('slot', 'production_url')
      .maybeSingle(),
    docSlug
      ? supabase
          .from('Document')
          .select('slug, title, content')
          .eq('spaceId', space.id)
          .eq('slug', docSlug)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const conversation =
    convResult.status === 'fulfilled' && convResult.value.data
      ? (convResult.value.data as ConversationRow)
      : null;

  let messages: TaskMessage[] = [];
  if (conversation) {
    const { data: msgRows } = await supabase
      .from('TaskMessage')
      .select('id, role, content, metadata, createdAt')
      .eq('conversationId', conversation.id)
      .order('createdAt', { ascending: true });
    messages = (msgRows ?? []) as MessageRow[];
  }

  const productionUrl =
    memResult.status === 'fulfilled' && memResult.value.data
      ? ((memResult.value.data as CoreMemoryRow).value ?? null)
      : null;

  const doc =
    docResult.status === 'fulfilled' &&
    docResult.value &&
    (docResult.value as { data?: DocumentRow | null }).data
      ? ((docResult.value as { data: DocumentRow }).data)
      : null;

  const breadcrumb = breadcrumbForGate(gate);
  const subject = subjectFromGate(gate);

  return (
    <TaskDetailLayout
      breadcrumb={breadcrumb}
      preview={{
        title: gate.title,
        classifierTitle: gate.title,
        description: null,
        productionUrl,
        documentContent: doc?.content ?? null,
        documentTitle: doc?.title ?? null,
      }}
      chat={{
        subject,
        target: { kind: 'gate', gateId: gate.id },
        initialConversationId: conversation?.id ?? null,
        initialMessages: messages,
      }}
    />
  );
}
