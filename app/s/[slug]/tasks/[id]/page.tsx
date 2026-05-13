/**
 * /s/[slug]/tasks/[id] — per-task split view.
 *
 * Left pane: a content preview shaped by the task title (iframe of the
 * production URL for build tasks, document body for doc tasks, the task
 * description otherwise).
 *
 * Right pane: the task-scoped TaskConversation. If no conversation exists
 * the page still renders — the first user message kicks creation.
 */

import { notFound, redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import { getSpaceFromSlug } from '@/lib/space';
import { supabase } from '@/lib/supabase';
import type { Task } from '@/lib/tasks/catalog';
import {
  breadcrumbForTask,
  subjectFromTask,
} from '@/lib/tasks/conversation-helpers';
import { TaskDetailLayout } from '@/components/canvas/task-detail-layout';
import type { TaskMessage } from '@/components/canvas/task-chat-thread';

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

export default async function TaskDetailPage({
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

  const { data: taskData, error: taskErr } = await supabase
    .from('Task')
    .select(
      'id, spaceId, title, description, status, priority, assigneeKind, assigneeDept, createdBy, createdByDept, dueAt, completedAt, createdAt, updatedAt',
    )
    .eq('id', id)
    .eq('spaceId', space.id)
    .maybeSingle();
  if (taskErr || !taskData) notFound();
  const task = taskData as Task;

  // Pull the existing conversation + production URL in parallel.
  const [convResult, memResult] = await Promise.allSettled([
    supabase
      .from('TaskConversation')
      .select('id')
      .eq('spaceId', space.id)
      .eq('taskId', task.id)
      .maybeSingle(),
    supabase
      .from('CoreMemory')
      .select('slot, value')
      .eq('spaceId', space.id)
      .eq('slot', 'production_url')
      .maybeSingle(),
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

  const breadcrumb = breadcrumbForTask(task);
  const subject = subjectFromTask(task);

  return (
    <TaskDetailLayout
      breadcrumb={breadcrumb}
      preview={{
        title: task.title,
        classifierTitle: task.title,
        description: task.description,
        productionUrl,
        documentContent: null,
        documentTitle: null,
      }}
      chat={{
        subject,
        target: { kind: 'task', taskId: task.id },
        initialConversationId: conversation?.id ?? null,
        initialMessages: messages,
      }}
    />
  );
}
