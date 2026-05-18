'use client';

/**
 * Right-edge chat dock — the always-present conversation surface.
 *
 * The dock holds the conversation. Typing in the input fires the agent
 * turn and streams the response inline; the canvas stays put. The
 * /s/[slug]/chat page is still the fullscreen deep-link view of the same
 * conversation — both consume `useAgentTask`, share the same blocks.
 *
 * Responsive contract:
 *   - "desktop" (default): hidden below md, fluid width (min 360, max 420,
 *     ~38vw) right-docked at md+. Always visible — no collapse rail.
 *   - "mobile": full-width, used inside the mobile full-screen overlay.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Plus, Loader2, RotateCcw, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAgentTask } from '@/components/ai/hooks/use-agent-task';
import { Transcript } from '@/components/ai/blocks/transcript';
import { ThinkingIndicator } from '@/components/ai/blocks/thinking-indicator';
import { blocksFromLegacyContent, type MessageBlock } from '@/lib/ai-tools/blocks';
import { Sapling } from './sapling';
import { CAPTION } from '@/lib/typography';
import type { DailyBriefingData } from '@/lib/briefing/build-daily-briefing';

const STORAGE_KEY_PREFIX = 'charles:chat-dock:conv:';

interface InitialMessage {
  role: 'user' | 'assistant';
  content: string;
  blocks?: MessageBlock[] | null;
}

interface ActivePlanSummary {
  id: string;
  goal: string;
  totalSteps: number;
  completedSteps: number;
}

interface Props {
  slug: string;
  /** Most-recent conversation id when one exists. The dock picks this up
   *  on first load; an in-flight send creates one when null. */
  initialConversationId: string | null;
  /** Server-loaded messages for `initialConversationId`, in order. */
  initialMessages: InitialMessage[];
  /** Server-hydrated count of pending approvals for this space. The dock
   *  keeps this live as `permission_required` / approve / deny events fire. */
  initialPendingApprovalsCount?: number;
  /** Plan in flight (planning/running/auditing), or null. When present
   *  the dock renders a pill at the top of the transcript that links
   *  through to the live Plan View. */
  activePlan?: ActivePlanSummary | null;
  /** Daily briefing snapshot. When set and not yet read today, Charles
   *  speaks it as his first message of the day. */
  briefing?: DailyBriefingData | null;
  /**
   * "desktop" (default): right-docked sidebar at md+, hidden on mobile.
   * "mobile": full-width, used inside the mobile overlay.
   */
  variant?: 'desktop' | 'mobile';
}

export function ChatDock({
  slug,
  initialConversationId,
  initialMessages,
  initialPendingApprovalsCount = 0,
  activePlan = null,
  briefing = null,
  variant = 'desktop',
}: Props) {
  const isMobile = variant === 'mobile';

  const lsKey = `${STORAGE_KEY_PREFIX}${slug}`;
  const [activeConversationId, setActiveConversationId] = useState<string | null>(
    initialConversationId,
  );
  const [pendingApprovalsCount, setPendingApprovalsCount] = useState(
    initialPendingApprovalsCount,
  );

  const {
    messages,
    setMessages,
    isStreaming,
    pendingApproval,
    liveCallIds,
    error: agentError,
    streamingReasoning,
    send,
    approve,
    deny,
    alwaysAllow,
    abort,
  } = useAgentTask({
    spaceSlug: slug,
    conversationId: activeConversationId,
    onConversationCreated: (id) => {
      setActiveConversationId(id);
      try {
        localStorage.setItem(lsKey, id);
      } catch {
        // Best-effort.
      }
    },
  });

  // Reconcile `pendingApprovalsCount` against the dock's own pendingApproval
  // edges. The server-hydrated count is the source of truth at mount; from
  // then on, each new prompt bumps the badge and each resolution (approve
  // or deny by this founder, in this dock) decrements it. Other tabs and
  // server-side scheduled fans are still observed via the existing realtime
  // refresher on the approvals page — this is the cheap inline signal that
  // keeps the chrome honest until then.
  const lastPendingRequestIdRef = useRef<string | null>(null);
  useEffect(() => {
    const current = pendingApproval?.requestId ?? null;
    const last = lastPendingRequestIdRef.current;
    if (current && current !== last) {
      setPendingApprovalsCount((n) => n + 1);
    } else if (!current && last) {
      setPendingApprovalsCount((n) => Math.max(0, n - 1));
    }
    lastPendingRequestIdRef.current = current;
  }, [pendingApproval]);

  // Briefing injection: when the dock would otherwise be empty AND we
  // have today's briefing AND the founder hasn't read it yet, Charles
  // speaks the briefing as the first message of the day. Per-day,
  // per-space localStorage gate prevents re-injection on remount.
  const [briefingInjected, setBriefingInjected] = useState(false);

  // Hydrate the initial transcript exactly once. After this the streaming
  // hook owns the message list — we don't re-seed on every render or the
  // streamed deltas would get clobbered.
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current) return;
    seededRef.current = true;
    if (initialMessages.length > 0) {
      setMessages(
        initialMessages.map((m, i) => ({
          id: `hist_${i}`,
          role: m.role,
          blocks:
            Array.isArray(m.blocks) && m.blocks.length > 0
              ? m.blocks
              : blocksFromLegacyContent(typeof m.content === 'string' ? m.content : ''),
        })),
      );
      return;
    }
    // No prior conversation today → consider briefing injection.
    if (!briefing) return;
    let readToday = false;
    try {
      readToday = localStorage.getItem(briefingReadKey(slug)) === todayLocalISO();
    } catch {
      // localStorage unavailable — treat as unread.
    }
    if (readToday) return;
    const text = composeBriefingMessage(briefing);
    if (!text) return;
    setMessages([
      {
        id: 'briefing_today',
        role: 'assistant',
        blocks: blocksFromLegacyContent(text),
      },
    ]);
    setBriefingInjected(true);
  }, [initialMessages, setMessages, briefing, slug]);

  // Once the founder sends a reply (or starts a new chat), mark today's
  // briefing as read so it doesn't reappear on remount.
  const markBriefingRead = useCallback(() => {
    try {
      localStorage.setItem(briefingReadKey(slug), todayLocalISO());
    } catch {
      // best-effort
    }
  }, [slug]);

  const hydrateConversation = useCallback(
    async (convId: string) => {
      try {
        const res = await fetch(`/api/ai/messages?conversationId=${convId}`);
        if (!res.ok) return;
        const data = (await res.json()) as InitialMessage[];
        setMessages(
          data.map((m, i) => ({
            id: `hist_${i}`,
            role: m.role,
            blocks:
              Array.isArray(m.blocks) && m.blocks.length > 0
                ? m.blocks
                : blocksFromLegacyContent(typeof m.content === 'string' ? m.content : ''),
          })),
        );
      } catch {
        // Network blip — the founder can try again.
      }
    },
    [setMessages],
  );

  // Remember the last conversation id the founder used so re-mounting the
  // dock (e.g. after navigating away and back) lands them on the same
  // thread rather than starting a fresh one. The server-provided
  // `initialConversationId` is the source of truth on first paint; this
  // localStorage hop only matters if the server picked a different default.
  useEffect(() => {
    try {
      const stored = localStorage.getItem(lsKey);
      if (stored && !activeConversationId && !initialConversationId) {
        setActiveConversationId(stored);
        void hydrateConversation(stored);
      }
    } catch {
      // localStorage unavailable — fall through.
    }
    // Run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Auto-scroll behavior ────────────────────────────────────────────────
  // Stick to the bottom on new content unless the founder has scrolled up.
  // The moment they scroll up, we stop auto-scrolling; the moment they
  // return to within 80px of the bottom, we resume.
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const stickyRef = useRef(true);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickyRef.current = distance < 80;
  }, []);

  useEffect(() => {
    if (!stickyRef.current) return;
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, pendingApproval, isStreaming]);

  // ── Composer state ─────────────────────────────────────────────────────
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const lastUserMsgRef = useRef<string>('');

  const handleSubmit = useCallback(async () => {
    const text = value.trim();
    if (!text || isStreaming || pendingApproval !== null) return;
    setValue('');
    lastUserMsgRef.current = text;
    if (briefingInjected) markBriefingRead();
    await send(text);
  }, [value, isStreaming, pendingApproval, send, briefingInjected, markBriefingRead]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Enter sends; Shift+Enter inserts a newline.
      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault();
        void handleSubmit();
      }
    },
    [handleSubmit],
  );

  // Auto-resize the textarea up to a small cap so the input grows with
  // multi-line drafts but doesn't eat the dock.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [value]);

  const handleNewChat = useCallback(() => {
    setActiveConversationId(null);
    setMessages([]);
    setBriefingInjected(false);
    if (briefingInjected) markBriefingRead();
    try {
      localStorage.removeItem(lsKey);
    } catch {
      // Best-effort.
    }
    inputRef.current?.focus();
  }, [setMessages, lsKey, briefingInjected, markBriefingRead]);

  const retry = useCallback(async () => {
    if (!lastUserMsgRef.current || isStreaming) return;
    await send(lastUserMsgRef.current);
  }, [send, isStreaming]);

  // ── Thinking line ──────────────────────────────────────────────────────
  // Same intent as the workspace's currentAction logic, trimmed for the
  // dock. We don't enumerate every tool name here — a single calm
  // status reads as honest, not robotic.
  const tailMessage = useMemo(
    () => messages[messages.length - 1] ?? null,
    [messages],
  );

  const currentAction = useMemo<string | null>(() => {
    if (!isStreaming || !tailMessage) return null;
    if (liveCallIds && liveCallIds.size > 0) return 'Working on it…';
    const hasText = tailMessage.blocks.some(
      (b) => b.type === 'text' && b.content.trim().length > 0,
    );
    if (!hasText) return 'Thinking…';
    return null;
  }, [isStreaming, tailMessage, liveCallIds]);

  const showThinking =
    isStreaming &&
    tailMessage?.role === 'assistant' &&
    (Boolean(currentAction) || Boolean(streamingReasoning?.trim()));

  const isEmpty = messages.length === 0;

  return (
    <aside
      data-testid="chat-dock"
      data-variant={variant}
      className={cn(
        'flex h-full flex-col bg-background',
        isMobile
          ? 'w-full'
          : 'hidden md:flex w-[min(420px,38vw)] min-w-[360px] max-w-[480px] border-l border-border/70',
      )}
    >
      <DockHeader
        slug={slug}
        pendingApprovalsCount={pendingApprovalsCount}
        onNewChat={handleNewChat}
      />

      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="flex-1 overflow-y-auto px-4 py-4"
        data-testid="chat-dock-thread"
      >
        {activePlan && (
          <Link
            href={`/s/${slug}/plans/${activePlan.id}`}
            data-testid="chat-dock-active-plan"
            className={cn(
              'mb-4 inline-flex w-full max-w-full items-center gap-2',
              'rounded-md border border-border/70 bg-background px-2.5 py-1.5',
              'transition-colors hover:bg-foreground/[0.02]',
            )}
          >
            <Sparkles
              size={12}
              strokeWidth={2}
              className="shrink-0 text-amber-600 dark:text-amber-400"
            />
            <span className="min-w-0 flex-1 truncate text-xs text-foreground">
              <span className="font-medium">Working on: </span>
              <span className="font-normal text-muted-foreground">{activePlan.goal}</span>
            </span>
            <span
              className={cn(CAPTION, 'shrink-0 tabular-nums text-muted-foreground/80')}
            >
              {activePlan.completedSteps}/{activePlan.totalSteps}
            </span>
          </Link>
        )}
        {isEmpty ? (
          <EmptyState />
        ) : (
          <div className="space-y-5">
            {messages.map((msg, i) => {
              const isTail = i === messages.length - 1;
              if (
                isTail &&
                msg.role === 'assistant' &&
                msg.blocks.length === 0 &&
                isStreaming
              ) {
                return null;
              }
              return (
                <Transcript
                  key={msg.id}
                  blocks={msg.blocks}
                  role={msg.role}
                  streaming={msg.streaming && isStreaming}
                  liveCallIds={liveCallIds}
                  pendingApproval={
                    isTail && pendingApproval && !isStreaming
                      ? {
                          prompt: pendingApproval,
                          onApprove: approve,
                          onDeny: deny,
                          onAlwaysAllow: alwaysAllow,
                          busy: isStreaming,
                        }
                      : undefined
                  }
                />
              );
            })}

            {showThinking && (
              <div className="flex gap-2.5">
                <div className="w-6 h-6 rounded-full overflow-hidden flex-shrink-0 mt-0.5 ring-1 ring-border/60">
                  <img src="/chip-avatar.png" alt="" className="w-full h-full object-cover" />
                </div>
                <div className="flex-1 min-w-0 pt-0.5">
                  <ThinkingIndicator
                    currentAction={currentAction}
                    streamingReasoning={streamingReasoning}
                  />
                </div>
              </div>
            )}

            {tailMessage?.role === 'assistant' &&
              agentError &&
              !isStreaming &&
              lastUserMsgRef.current && (
                <button
                  type="button"
                  onClick={() => void retry()}
                  className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1.5 transition-colors"
                >
                  <RotateCcw size={11} />
                  Try again
                </button>
              )}

            <div ref={bottomRef} />
          </div>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void handleSubmit();
        }}
        className="border-t border-border/70 p-3"
      >
        <div className="relative">
          <textarea
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="What are we shipping?"
            rows={1}
            disabled={pendingApproval !== null}
            className={cn(
              'block w-full resize-none rounded-md border border-input bg-transparent',
              'px-3 py-2 pr-10 text-sm text-foreground placeholder:text-muted-foreground/70',
              'focus-visible:outline-none focus-visible:border-ring',
              'focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-1 focus-visible:ring-offset-background',
              'transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed',
              'leading-[1.4] min-h-9',
            )}
            data-testid="chat-dock-input"
          />
          {isStreaming ? (
            <button
              type="button"
              onClick={() => abort()}
              aria-label="Stop"
              className="absolute right-1 top-1 inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-foreground/[0.06] transition-colors"
              data-testid="chat-dock-stop"
            >
              <Loader2 size={14} className="animate-spin" />
            </button>
          ) : (
            <button
              type="submit"
              aria-label="Send"
              disabled={value.trim().length === 0 || pendingApproval !== null}
              className={cn(
                'absolute right-1 top-1 inline-flex h-7 w-7 items-center justify-center',
                'rounded-md bg-foreground text-background transition-opacity duration-150',
                'disabled:opacity-30 disabled:cursor-not-allowed',
                'active:scale-[0.97]',
              )}
              data-testid="chat-dock-send"
            >
              <ArrowRight size={14} />
            </button>
          )}
        </div>
      </form>
    </aside>
  );
}

function DockHeader({
  slug,
  pendingApprovalsCount,
  onNewChat,
}: {
  slug: string;
  pendingApprovalsCount: number;
  onNewChat: () => void;
}) {
  return (
    <div className="flex h-10 items-center justify-between border-b border-border/70 px-3">
      <div className="flex items-center gap-2">
        <Sapling size={14} />
        <span className="text-[12px] font-medium text-foreground">Charles</span>
        {pendingApprovalsCount > 0 && (
          <Link
            href={`/s/${slug}/chat/approvals`}
            data-testid="chat-dock-approvals-badge"
            className={cn(
              CAPTION,
              'inline-flex items-center gap-1 rounded-full border border-border/70 bg-background px-1.5 py-0.5',
              'tabular-nums hover:text-foreground hover:border-border transition-colors',
            )}
            aria-label={`${pendingApprovalsCount} pending ${pendingApprovalsCount === 1 ? 'approval' : 'approvals'}`}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
            {pendingApprovalsCount} waiting
          </Link>
        )}
      </div>
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          onClick={onNewChat}
          aria-label="New conversation"
          title="New conversation"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-foreground/[0.04] transition-colors duration-150"
          data-testid="chat-dock-new"
        >
          <Plus size={13} />
        </button>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div
      className="flex h-full flex-col items-start justify-end gap-4 pb-2"
      data-testid="chat-dock-empty"
    >
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <Sapling size={18} />
          <p className="text-sm font-medium text-foreground">Let&rsquo;s get to work.</p>
        </div>
        <p className="text-sm leading-[1.55] text-muted-foreground">
          Tell me what we&rsquo;re working on.
        </p>
      </div>
    </div>
  );
}

// ── Briefing helpers ────────────────────────────────────────────────────
// Local calendar date (not UTC) — the briefing turns over at the founder's
// midnight, same convention as MorningBriefing.todayLocal.
function todayLocalISO(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function briefingReadKey(slug: string): string {
  return `charles:briefing-read:${slug}:${todayLocalISO()}`;
}

/**
 * Compose the briefing as Charles speaking — three short paragraphs, no
 * bullets, no exclamation marks. Rest day collapses to one sentence.
 * Returns null when there's literally nothing to say (which shouldn't
 * happen with a non-null briefing, but defensive).
 */
export function composeBriefingMessage(data: DailyBriefingData): string | null {
  const name = data.founderFirstName?.trim();
  const greeting = name ? `Morning, ${name}.` : 'Morning.';

  if (data.isRestDay) {
    return `${greeting} Nothing's flagged. Use the hour for the work only you can do.`;
  }

  const paragraphs: string[] = [greeting];

  if (data.yesterdayHighlights.length > 0) {
    const recap = data.yesterdayHighlights.join(' ');
    paragraphs.push(`While you were away: ${recap}`);
  }

  if (data.needsYouToday.length > 0) {
    const actions = data.needsYouToday.map((a) => a.label).join(' ');
    paragraphs.push(`What needs you today: ${actions}`);
  } else if (data.pendingApprovalsCount === 0 && data.openTasksCount === 0) {
    paragraphs.push("Nothing on your plate this morning. Tell me what we're chasing today.");
  }

  if (paragraphs.length === 1) return null;
  return paragraphs.join('\n\n');
}
