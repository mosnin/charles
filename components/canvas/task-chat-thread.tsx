'use client';

/**
 * Task-scoped chat thread — the right pane of /tasks/[id] and
 * /stages/gates/[id]. Visually mirrors the chat dock: 5 tabs at top,
 * thread in the middle, single-line input at the bottom. Only the
 * "Charles" tab carries live state; the other four read "Coming soon".
 *
 * Wave 2: the message list is fed by Convex's reactive query
 * (useTaskChat). The first user message still kicks off conversation
 * creation via POST /api/task-conversations if the row doesn't exist;
 * after that, sends are dual-written — Convex for instant fan-out
 * across tabs, Supabase via the existing POST as the audit-of-record.
 * When Convex is unconfigured the hook silently falls back to the
 * fetched initialMessages, so the chat still works.
 */

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SubagentChip } from './subagent-chip';
import { EMPTY_TASK_GREETING } from '@/lib/tasks/conversation-helpers';
import {
  DEPARTMENT_LABELS,
  type DepartmentSlug,
} from '@/lib/tasks/catalog';
import { useTaskChat, type ChatMessage } from '@/lib/convex/use-task-chat';

const TABS = ['Home', 'Company', 'Charles', 'Tasks', 'Library'] as const;
type Tab = (typeof TABS)[number];

export interface TaskMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

interface Props {
  /** Breadcrumb shown inside the pane (e.g. "Engineering / Landing Page Updates"). */
  breadcrumb: string;
  /** Subject stamped on a fresh conversation row on first send. */
  subject: string;
  /** Space the conversation belongs to (drives Convex room scoping). */
  spaceId: string;
  /** Either taskId or gateId — whichever this conversation belongs to. */
  target: { kind: 'task'; taskId: string } | { kind: 'gate'; gateId: string };
  /** The existing conversation id, or null if the row hasn't been created yet. */
  initialConversationId: string | null;
  /** The existing messages, oldest first. Empty when there's no row yet. */
  initialMessages: TaskMessage[];
}

function toChatMessages(rows: TaskMessage[]): ChatMessage[] {
  return rows.map((m) => ({
    id: m.id,
    role: m.role,
    content: m.content,
    metadata: m.metadata,
    createdAt: new Date(m.createdAt).getTime(),
  }));
}

export function TaskChatThread({
  breadcrumb,
  subject,
  spaceId,
  target,
  initialConversationId,
  initialMessages,
}: Props) {
  const [tab, setTab] = useState<Tab>('Charles');
  const [conversationId, setConversationId] = useState<string | null>(initialConversationId);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [lastAttempt, setLastAttempt] = useState<string | null>(null);
  const [optimistic, setOptimistic] = useState<ChatMessage[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const seed = useMemo(() => toChatMessages(initialMessages), [initialMessages]);

  const chat = useTaskChat({
    spaceId,
    conversationId,
    initialMessages: seed,
  });

  // Compose: canonical (Convex or fetched seed) + any optimistic rows
  // that haven't yet appeared in the canonical list (matched by content
  // + role + a sub-second window).
  const messages = useMemo(() => {
    const canonical = chat.messages;
    if (optimistic.length === 0) return canonical;
    const filtered = optimistic.filter((o) => {
      return !canonical.some(
        (c) =>
          c.role === o.role &&
          c.content === o.content &&
          Math.abs(c.createdAt - o.createdAt) < 60_000,
      );
    });
    return [...canonical, ...filtered];
  }, [chat.messages, optimistic]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length, chat.isSending]);

  // GC optimistic rows once the canonical stream has them.
  useEffect(() => {
    if (optimistic.length === 0) return;
    setOptimistic((prev) =>
      prev.filter((o) => {
        return !chat.messages.some(
          (c) =>
            c.role === o.role &&
            c.content === o.content &&
            Math.abs(c.createdAt - o.createdAt) < 60_000,
        );
      }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.messages.length]);

  async function ensureConversation(): Promise<string | null> {
    if (conversationId) return conversationId;
    const res = await fetch('/api/task-conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subject,
        taskId: target.kind === 'task' ? target.taskId : undefined,
        gateId: target.kind === 'gate' ? target.gateId : undefined,
      }),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { conversation?: { id: string } };
    if (!body.conversation) return null;
    setConversationId(body.conversation.id);
    return body.conversation.id;
  }

  async function sendMessage(text: string) {
    if (!text || chat.isSending) return;
    setError(null);
    setLastAttempt(text);

    const id = await ensureConversation();
    if (!id) {
      setError('Could not start the conversation. Try again.');
      return;
    }

    const optimisticRow: ChatMessage = {
      id: `temp_${Date.now()}`,
      role: 'user',
      content: text,
      metadata: null,
      createdAt: Date.now(),
    };
    setOptimistic((prev) => [...prev, optimisticRow]);

    try {
      await chat.send(text);
    } catch {
      setOptimistic((prev) => prev.filter((m) => m.id !== optimisticRow.id));
      setError('That message failed to send.');
    } finally {
      inputRef.current?.focus();
    }
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const text = value.trim();
    if (!text || chat.isSending) return;
    setValue('');
    await sendMessage(text);
  }

  async function retry() {
    if (!lastAttempt || chat.isSending) return;
    await sendMessage(lastAttempt);
  }

  return (
    <div
      data-testid="task-chat-thread"
      className="flex h-full min-h-0 flex-col bg-white"
    >
      {/* Tabs */}
      <div className="flex h-10 items-stretch border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            data-testid={`task-chat-tab-${t.toLowerCase()}`}
            className={cn(
              'flex-1 text-[12px] transition-colors',
              tab === t
                ? 'border-b-2 border-slate-900 font-semibold text-slate-900'
                : 'text-slate-500 hover:text-slate-900',
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Breadcrumb */}
      <div className="border-b border-slate-200 px-4 py-3">
        <p className="font-mono text-[11px] uppercase tracking-wide text-slate-500">
          {breadcrumb}
        </p>
      </div>

      {/* Thread */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">
        {tab === 'Charles' ? (
          <ThreadBody
            messages={messages}
            pendingAssistant={chat.isSending}
            greeting={EMPTY_TASK_GREETING}
          />
        ) : (
          <ComingSoon label={tab} />
        )}
      </div>

      {/* Error banner */}
      {error && (
        <div
          data-testid="task-chat-error"
          className="flex items-center justify-between border-t border-rose-200 bg-rose-50 px-4 py-2 text-[12px] text-rose-900"
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={retry}
            disabled={chat.isSending}
            className="ml-3 rounded-md border border-rose-300 bg-white px-2 py-0.5 text-[11px] font-medium text-rose-900 disabled:opacity-50"
          >
            Retry
          </button>
        </div>
      )}

      {/* Input */}
      <form onSubmit={submit} className="border-t border-slate-200 p-3">
        <div className="relative">
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={chat.isSending || tab !== 'Charles'}
            placeholder="Ask Charles to spin up new task agents…"
            className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-3 pr-10 text-[13px] text-slate-900 placeholder:text-slate-400 outline-none focus:border-slate-400 disabled:opacity-50"
          />
          <button
            type="submit"
            aria-label="Send to Charles"
            disabled={value.trim().length === 0 || chat.isSending || tab !== 'Charles'}
            className="absolute right-1 top-1 inline-flex h-7 w-7 items-center justify-center rounded-md bg-slate-900 text-white disabled:opacity-30"
          >
            <ArrowRight size={14} />
          </button>
        </div>
      </form>
    </div>
  );
}

function ThreadBody({
  messages,
  pendingAssistant,
  greeting,
}: {
  messages: ChatMessage[];
  pendingAssistant: boolean;
  greeting: string;
}) {
  if (messages.length === 0 && !pendingAssistant) {
    return (
      <div className="space-y-4">
        <Message role="assistant" body={greeting} />
      </div>
    );
  }
  return (
    <div className="space-y-4">
      {messages.map((m) => (
        <MessageRow key={m.id} message={m} />
      ))}
      {pendingAssistant && (
        <div className="space-y-1">
          <div className="text-[11px] text-slate-500">Charles</div>
          <div className="text-[13px] italic leading-[1.5] text-slate-500">Thinking…</div>
        </div>
      )}
    </div>
  );
}

function MessageRow({ message }: { message: ChatMessage }) {
  const delegated =
    message.role === 'assistant' && message.metadata && typeof message.metadata === 'object'
      ? ((message.metadata as { delegatedTo?: DepartmentSlug | null }).delegatedTo ?? null)
      : null;

  return (
    <div className="space-y-2">
      <Message role={message.role} body={message.content} />
      {delegated && (
        <div className="space-y-1">
          <div className="text-[11px] text-slate-500">Delegating to subagent</div>
          <SubagentChip
            department={delegated}
            agentName={`${DEPARTMENT_LABELS[delegated]} Agent`}
            task={`Picking up the work`}
            status="queued"
            duration="—"
          />
        </div>
      )}
    </div>
  );
}

function Message({ role, body }: { role: 'user' | 'assistant' | 'system'; body: string }) {
  const isUser = role === 'user';
  return (
    <div className="space-y-1">
      <div className={cn('text-[11px]', isUser ? 'text-slate-400' : 'text-slate-500')}>
        {isUser ? 'You' : 'Charles'}
      </div>
      <div
        className={cn(
          'text-[13px] leading-[1.5]',
          isUser ? 'text-slate-600' : 'text-slate-900',
        )}
      >
        {body}
      </div>
    </div>
  );
}

function ComingSoon({ label }: { label: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center text-center">
      <div className="text-[12px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-1 text-[13px] text-slate-500">Coming soon.</div>
    </div>
  );
}
