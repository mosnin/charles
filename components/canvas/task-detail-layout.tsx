'use client';

/**
 * Two-pane layout for /tasks/[id] and /stages/gates/[id].
 *
 *   ─────────────────────────────────────────────────────────────
 *   │ breadcrumb · monospace · uppercase                          │
 *   ├────────────────────────┬──────────────────────────────────  │
 *   │                        │                                    │
 *   │  TaskContentPreview    │  TaskChatThread                    │
 *   │  (~55%)                │  (~45%)                            │
 *   │                        │                                    │
 *   ─────────────────────────────────────────────────────────────
 *
 * The divider is a 4px draggable handle that lives between the panes;
 * it stores the split ratio in component state. Below md the panes
 * stack vertically and the divider is hidden.
 */

import { useCallback, useRef, useState, useEffect, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { TaskContentPreview, type PreviewProps } from './task-content-preview';
import { TaskChatThread, type TaskMessage } from './task-chat-thread';

interface Props {
  breadcrumb: string;
  preview: PreviewProps;
  chat: {
    subject: string;
    target: { kind: 'task'; taskId: string } | { kind: 'gate'; gateId: string };
    initialConversationId: string | null;
    initialMessages: TaskMessage[];
  };
}

const MIN_PCT = 30;
const MAX_PCT = 75;
const DEFAULT_PCT = 55;

export function TaskDetailLayout({ breadcrumb, preview, chat }: Props) {
  const [leftPct, setLeftPct] = useState<number>(DEFAULT_PCT);
  const containerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    draggingRef.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    draggingRef.current = false;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const pct = ((e.clientX - rect.left) / rect.width) * 100;
    setLeftPct(Math.min(MAX_PCT, Math.max(MIN_PCT, pct)));
  }, []);

  // Keyboard-accessible resize for the splitter handle.
  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft') {
      setLeftPct((p) => Math.max(MIN_PCT, p - 2));
    } else if (e.key === 'ArrowRight') {
      setLeftPct((p) => Math.min(MAX_PCT, p + 2));
    }
  }, []);

  useEffect(() => {
    // Cancel any stale drag on unmount.
    return () => {
      draggingRef.current = false;
    };
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      {/* Top breadcrumb */}
      <header className="border-b border-slate-200 px-6 py-4">
        <p
          className="font-mono text-[11px] uppercase tracking-wide text-slate-500"
          data-testid="task-detail-breadcrumb"
        >
          {breadcrumb}
        </p>
      </header>

      {/* Mobile: stacked. Desktop: split. */}
      <div
        ref={containerRef}
        className="flex min-h-0 flex-1 flex-col md:flex-row"
      >
        <Pane
          className="min-h-[320px] flex-1 md:min-h-0"
          style={{ flexBasis: `${leftPct}%` }}
          testid="task-detail-preview-pane"
        >
          <TaskContentPreview {...preview} />
        </Pane>

        {/* Divider — desktop only */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize panes"
          tabIndex={0}
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
          onPointerMove={onPointerMove}
          onKeyDown={onKeyDown}
          className={cn(
            'hidden md:block',
            'w-1 cursor-col-resize bg-slate-200 hover:bg-slate-300',
            'focus-visible:outline-none focus-visible:bg-slate-400',
            'transition-colors duration-150',
          )}
          data-testid="task-detail-divider"
        />

        <Pane
          className="min-h-[480px] flex-1 border-t border-slate-200 md:min-h-0 md:border-t-0"
          style={{ flexBasis: `${100 - leftPct}%` }}
          testid="task-detail-chat-pane"
        >
          <TaskChatThread
            breadcrumb={breadcrumb}
            subject={chat.subject}
            target={chat.target}
            initialConversationId={chat.initialConversationId}
            initialMessages={chat.initialMessages}
          />
        </Pane>
      </div>
    </div>
  );
}

function Pane({
  children,
  className,
  style,
  testid,
}: {
  children: ReactNode;
  className?: string;
  style?: React.CSSProperties;
  testid: string;
}) {
  return (
    <div
      className={cn('min-w-0 overflow-hidden', className)}
      style={style}
      data-testid={testid}
    >
      <div className="h-full min-h-0">{children}</div>
    </div>
  );
}
