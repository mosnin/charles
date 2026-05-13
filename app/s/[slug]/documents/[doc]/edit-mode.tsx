'use client';

/**
 * Rich-text editor surface.
 *
 * TipTap + StarterKit + Link + tiptap-markdown. The editor reads markdown in,
 * serializes markdown out. Autosave is debounced 800ms so the network only
 * speaks once the founder has stopped typing.
 *
 * Calm by default: no toolbar, no chrome. The keyboard does the work.
 *   ⌘B — bold
 *   ⌘I — italic
 *   ⌘K — link (prompts for URL)
 *   ⌘1 / ⌘2 / ⌘3 — heading levels
 *   ⌘⇧7 — ordered list
 *   ⌘⇧8 — bullet list
 *
 * A small save indicator sits below the editor: "Saved · 12:04" / "Saving…"
 * / "Failed to save". No spinner.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import { Markdown } from 'tiptap-markdown';
import { cn } from '@/lib/utils';
import { BODY_MUTED, CAPTION } from '@/lib/typography';

type SaveState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved'; at: string }
  | { kind: 'error' };

interface EditModeProps {
  slug: string;
  initialContent: string;
}

const DEBOUNCE_MS = 800;

export function EditMode({ slug, initialContent }: EditModeProps) {
  const [saveState, setSaveState] = useState<SaveState>({ kind: 'idle' });
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflightRef = useRef<AbortController | null>(null);

  const save = useCallback(
    async (markdown: string) => {
      inflightRef.current?.abort();
      const ctrl = new AbortController();
      inflightRef.current = ctrl;
      setSaveState({ kind: 'saving' });
      try {
        const res = await fetch(`/api/documents/${slug}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: markdown }),
          signal: ctrl.signal,
        });
        if (!res.ok) {
          setSaveState({ kind: 'error' });
          return;
        }
        const body = (await res.json()) as { updatedAt: string };
        setSaveState({ kind: 'saved', at: body.updatedAt });
      } catch (err) {
        if ((err as { name?: string }).name === 'AbortError') return;
        setSaveState({ kind: 'error' });
      }
    },
    [slug],
  );

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // Link comes from the dedicated extension below for openOnClick + rel.
      }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: {
          rel: 'noopener noreferrer nofollow',
          target: '_blank',
        },
      }),
      Markdown.configure({
        html: false,
        linkify: true,
        breaks: false,
        transformPastedText: true,
      }),
    ],
    content: initialContent,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: cn(
          'tiptap-doc focus:outline-none',
          // Calm reading column.
          'mx-auto max-w-[70ch]',
          // ProseMirror typography: generous line-height, system stack.
          'text-base leading-[1.65] text-foreground',
          // Prose-ish defaults without pulling in @tailwindcss/typography.
          '[&_h1]:mt-8 [&_h1]:mb-3 [&_h1]:text-2xl [&_h1]:font-semibold',
          '[&_h2]:mt-7 [&_h2]:mb-2 [&_h2]:text-xl  [&_h2]:font-semibold',
          '[&_h3]:mt-6 [&_h3]:mb-2 [&_h3]:text-base [&_h3]:font-semibold',
          '[&_p]:my-3',
          '[&_ul]:my-3 [&_ul]:pl-6 [&_ul]:list-disc',
          '[&_ol]:my-3 [&_ol]:pl-6 [&_ol]:list-decimal',
          '[&_li]:my-1',
          '[&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-4 [&_blockquote]:text-muted-foreground',
          '[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[0.85em]',
          '[&_pre]:my-4 [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3 [&_pre]:text-[13px] [&_pre]:overflow-x-auto',
          '[&_a]:underline [&_a]:underline-offset-2 [&_a]:text-foreground',
          '[&_hr]:my-6 [&_hr]:border-border',
        ),
      },
      handleKeyDown(_view, event) {
        // ⌘K / Ctrl+K → link prompt. Everything else is StarterKit defaults.
        const isMod = event.metaKey || event.ctrlKey;
        if (isMod && event.key.toLowerCase() === 'k') {
          event.preventDefault();
          const url = window.prompt('Link URL');
          if (url === null) return true;
          if (url === '') {
            editor?.chain().focus().unsetLink().run();
          } else {
            editor?.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
          }
          return true;
        }
        return false;
      },
    },
    onUpdate({ editor }) {
      // tiptap-markdown injects storage.markdown.getMarkdown()
      const storage = (editor.storage as { markdown?: { getMarkdown: () => string } }).markdown;
      const markdown = storage?.getMarkdown?.() ?? '';
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        void save(markdown);
      }, DEBOUNCE_MS);
    },
  });

  // Flush pending debounce on unmount so a fast Back doesn't lose the last keystroke.
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      inflightRef.current?.abort();
    };
  }, []);

  return (
    <section className="space-y-3">
      <div className="rounded-xl border border-border/70 bg-background px-6 py-8">
        <EditorContent editor={editor} />
      </div>
      <div className="mx-auto flex max-w-[70ch] items-center justify-between gap-3">
        <p className={cn(CAPTION)}>
          ⌘B bold · ⌘I italic · ⌘K link · ⌘1/2/3 heading · ⌘⇧8 bullets
        </p>
        <SaveIndicator state={saveState} />
      </div>
    </section>
  );
}

function SaveIndicator({ state }: { state: SaveState }) {
  if (state.kind === 'idle') {
    return <span className={cn(BODY_MUTED, 'text-xs')}>&nbsp;</span>;
  }
  if (state.kind === 'saving') {
    return <span className={cn(BODY_MUTED, 'text-xs')}>Saving…</span>;
  }
  if (state.kind === 'error') {
    return (
      <span className="text-xs text-[color:var(--charles-destructive,#8B1A1A)]">
        Failed to save.
      </span>
    );
  }
  // saved
  const time = new Date(state.at).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
  return <span className={cn(BODY_MUTED, 'text-xs')}>Saved · {time}</span>;
}
