'use client';

/**
 * Home-page prompt input. Calm, single-purpose. Enter (or click ↵) hands
 * the prompt to /chat which owns the actual conversation.
 */

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ArrowRight } from 'lucide-react';

export function HomePrompt({ slug }: { slug: string }) {
  const router = useRouter();
  const [value, setValue] = useState('');

  function submit() {
    const v = value.trim();
    if (!v) {
      router.push(`/s/${slug}/chat`);
      return;
    }
    router.push(`/s/${slug}/chat?prompt=${encodeURIComponent(v)}`);
  }

  function onKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="relative"
    >
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKey}
        rows={3}
        placeholder="Ask Charles to do something."
        autoFocus
        className="w-full resize-none rounded-2xl border border-border bg-background px-5 py-4 pr-14 text-base text-foreground placeholder:text-muted-foreground/60 outline-none focus:border-foreground/40 transition-colors"
      />
      <button
        type="submit"
        aria-label="Send to Charles"
        className="absolute bottom-3 right-3 inline-flex h-9 w-9 items-center justify-center rounded-lg bg-foreground text-background hover:opacity-90 transition-opacity disabled:opacity-40"
        disabled={value.trim().length === 0}
      >
        <ArrowRight size={16} />
      </button>
    </form>
  );
}
