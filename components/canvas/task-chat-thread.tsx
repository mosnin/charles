'use client';

/**
 * Task-scoped chat thread — the right pane of /tasks/[id] and
 * /stages/gates/[id]. Visually mirrors the chat dock: 5 tabs at top,
 * thread in the middle, single-line input at the bottom. Only the
 * "Charles" tab carries live state; the other four read "Coming soon"
 * so the founder sees the system shape but isn't asked to pick yet.
 *
 * The thread itself is the per-task TaskConversation. The first user
 * message kicks off conversation creation (POST /api/task-conversations)
 * if the row doesn't yet exist, then posts the message.
 */

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SubagentChip } from './subagent-chip';
import { EMPTY_TASK_GREETING } from '@/lib/tasks/conversation-helpers';
import {
  DEPARTMENT_LABELS,
  type DepartmentSlug,
} from '@/lib/tasks/catalog';

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
  /** Either taskId or gateId — whichever this conversation belongs to. */
  target: { kind: 'task'; taskId: string } | { kind: 'gate'; gateId: string };
  /** The existing conversation id, or null if the row hasn't been created yet. */
  initialConversationId: string | null;
  /** The existing messages, oldest first. Empty when there's no row yet. */
  initialMessages: TaskMessage[];
}

export function TaskChatThread({
  breadcrumb,
  subject,
  target,
  initialConversationId,
  initialMessages,
}: Props) {
  const [tab, setTab] = useState<Tab>('Charles');
  const [conversationId, setConversationId] = useState<string | null>(initialConversationId);
  const [messages, setMessages] = useState<TaskMessage[]>(initialMessages);
  const [value, setValue] = useState('');
  const [pending, setPending] = useState(false);
  const [pendingAssistant, setPendingAssistant] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to the bottom on new messages.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length, pendingAssistant]);

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

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const text = value.trim();
    if (!text || pending) return;

    setPending(true);

    // Optimistic user message.
    const tempId = `temp_${Date.now()}`;
    const optimisticUser: TaskMessage = {
      id: tempId,
      role: 'user',
      content: text,
      metadata: null,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimisticUser]);
    setValue('');
    setPendingAssistant(true);

    try {
      const id = await ensureConversation();
      if (!id) {
        // Roll back optimistic message.
        setMessages((prev) => prev.filter((m) => m.id !== tempId));
        return;
      }

      const res = await fetch(`/api/task-conversations/${id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: text }),
      });
      if (!res.ok) {
        setMessages((prev) => prev.filter((m) => m.id !== tempId));
        return;
      }
      const body = (await res.json()) as { user: TaskMessage; assistant: TaskMessage };
      setMessages((prev) => {
        const withoutTemp = prev.filter((m) => m.id !== tempId);
        return [...withoutTemp, body.user, body.assistant];
      });
    } finally {
      setPending(false);
      setPendingAssistant(false);
      inputRef.current?.focus();
    }
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
            pendingAssistant={pendingAssistant}
            greeting={EMPTY_TASK_GREETING}
          />
        ) : (
          <ComingSoon label={tab} />
        )}
      </div>

      {/* Input */}
      <form onSubmit={submit} className="border-t border-slate-200 p-3">
        <div className="relative">
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={pending || tab !== 'Charles'}
            placeholder="Ask Charles to spin up new task agents…"
            className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-3 pr-10 text-[13px] text-slate-900 placeholder:text-slate-400 outline-none focus:border-slate-400 disabled:opacity-50"
          />
          <button
            type="submit"
            aria-label="Send to Charles"
            disabled={value.trim().length === 0 || pending || tab !== 'Charles'}
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
  messages: TaskMessage[];
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

function MessageRow({ message }: { message: TaskMessage }) {
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
