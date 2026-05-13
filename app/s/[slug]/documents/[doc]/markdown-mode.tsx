'use client';

/**
 * Read-only raw markdown view.
 *
 * The source of truth is the rich-text editor. This mode exists so the
 * founder can pull the markdown out — into Notion, a commit, a draft email —
 * without leaving the page. One button: Copy. That's it.
 */

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { cn } from '@/lib/utils';
import { BODY_MUTED, CAPTION } from '@/lib/typography';

interface MarkdownModeProps {
  content: string;
}

export function MarkdownMode({ content }: MarkdownModeProps) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (!content) return;
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard can fail under iframes / insecure contexts. Stay quiet.
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className={CAPTION}>The same content, as plain markdown.</p>
        <button
          type="button"
          onClick={copy}
          disabled={!content}
          className={cn(
            'inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-sm transition-colors duration-150',
            'border border-border/70 text-muted-foreground hover:text-foreground hover:bg-foreground/[0.04]',
            'disabled:opacity-50 disabled:cursor-not-allowed',
          )}
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre
        className={cn(
          'rounded-xl border border-border/70 bg-muted/30 p-5',
          'whitespace-pre-wrap break-words',
          'font-mono text-[13px] leading-[1.65] text-foreground',
          'max-h-[70vh] overflow-auto',
        )}
      >
        {content || <span className={BODY_MUTED}>Nothing here yet.</span>}
      </pre>
    </section>
  );
}
