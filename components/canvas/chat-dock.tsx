'use client';

/**
 * Right-edge chat dock — the always-present surface for talking to Charles.
 *
 * Five tabs (Home, Company, Charles, Tasks, Library), a message thread, a
 * single-line prompt input. The dock collapses to a 32px rail; the state
 * persists in localStorage so the founder's preference survives reloads.
 *
 * Today: messages and subagent chips are static examples. Real chat lives
 * at /s/{slug}/chat; submitting the prompt hands off there with the text
 * as a query param.
 */

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, ChevronRight, ChevronLeft, MessageSquare } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SubagentChip } from './subagent-chip';

const TABS = ['Home', 'Company', 'Charles', 'Tasks', 'Library'] as const;
type Tab = (typeof TABS)[number];

const STORAGE_KEY = 'charles:chat-dock:collapsed';

interface Props {
  slug: string;
}

export function ChatDock({ slug }: Props) {
  const router = useRouter();
  const [collapsed, setCollapsed] = useState<boolean>(false);
  const [tab, setTab] = useState<Tab>('Home');
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Hydrate collapsed state from localStorage on mount.
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === '1') setCollapsed(true);
    } catch {
      // localStorage unavailable — keep default.
    }
  }, []);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
      } catch {
        // Best-effort.
      }
      return next;
    });
  }

  function submit() {
    const v = value.trim();
    if (!v) {
      router.push(`/s/${slug}/chat`);
      return;
    }
    router.push(`/s/${slug}/chat?prompt=${encodeURIComponent(v)}`);
  }

  if (collapsed) {
    return (
      <aside
        data-testid="chat-dock"
        data-collapsed="true"
        className="flex h-full w-8 flex-col items-center border-l border-slate-200 bg-white py-2"
      >
        <button
          type="button"
          aria-label="Expand chat dock"
          onClick={toggleCollapsed}
          className="flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-900"
        >
          <ChevronLeft size={14} />
        </button>
        <div className="mt-3 flex h-7 w-7 items-center justify-center text-slate-400">
          <MessageSquare size={14} />
        </div>
      </aside>
    );
  }

  return (
    <aside
      data-testid="chat-dock"
      data-collapsed="false"
      className="flex h-full w-[420px] flex-col border-l border-slate-200 bg-white"
    >
      {/* Tabs */}
      <div className="flex h-10 items-stretch border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            data-testid={`chat-dock-tab-${t.toLowerCase()}`}
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
        <button
          type="button"
          aria-label="Collapse chat dock"
          onClick={toggleCollapsed}
          className="flex w-8 items-center justify-center border-l border-slate-200 text-slate-400 hover:text-slate-900"
        >
          <ChevronRight size={14} />
        </button>
      </div>

      {/* Thread */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {tab === 'Home' || tab === 'Charles' ? (
          <HomeThread />
        ) : (
          <ComingSoon label={tab} />
        )}
      </div>

      {/* Input */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="border-t border-slate-200 p-3"
      >
        <div className="relative">
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Ask Charles to spin up new task agents…"
            className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-3 pr-10 text-[13px] text-slate-900 placeholder:text-slate-400 outline-none focus:border-slate-400"
          />
          <button
            type="submit"
            aria-label="Send to Charles"
            disabled={value.trim().length === 0}
            className="absolute right-1 top-1 inline-flex h-7 w-7 items-center justify-center rounded-md bg-slate-900 text-white disabled:opacity-30"
          >
            <ArrowRight size={14} />
          </button>
        </div>
      </form>
    </aside>
  );
}

function HomeThread() {
  return (
    <div className="space-y-4">
      <Message author="Charles" body="I'm tracking three things today. Two need a decision." />
      <Message
        author="Charles"
        body="The growth agent has a prospect list ready. The sales agent is drafting outreach now."
      />

      <div className="space-y-2">
        <SubagentChip
          department="marketing"
          agentName="Growth Agent"
          task="Building prospect list"
          status="running"
          duration="00:42"
        />
        <SubagentChip
          department="sales"
          agentName="Sales Agent"
          task="Writing personalised 3-step outreach"
          status="queued"
          duration="—"
        />
      </div>

      <Message author="You" body="Show me the prospect list when it's done." />
      <Message author="Charles" body="Will do. I'll surface it the moment it lands." />
    </div>
  );
}

function Message({ author, body }: { author: 'Charles' | 'You'; body: string }) {
  const isFounder = author === 'You';
  return (
    <div className="space-y-1">
      <div
        className={cn(
          'text-[11px]',
          isFounder ? 'text-slate-400' : 'text-slate-500',
        )}
      >
        {author}
      </div>
      <div
        className={cn(
          'text-[13px] leading-[1.5]',
          isFounder ? 'text-slate-600' : 'text-slate-900',
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
