'use client';

/**
 * Left pane of /tasks/[id] and /stages/gates/[id] — the content the
 * conversation is *about*. The shape depends on the row's title:
 *
 *   - Build/ship/website/deploy/landing  → iframe of the production URL
 *     when CoreMemory.production_url is set; "connect Vercel" empty state
 *     otherwise.
 *   - Brand/logo/pitch/deck/doc          → render the linked Document.
 *   - Anything else                       → description + "what's this for"
 *     blurb from the gate / task.
 *
 * Pure presentation. The route loads the data; this component picks the
 * shape and renders it inside a single Card.
 */

import { cn } from '@/lib/utils';
import { SERIF_CARD, MONO_CHIP } from '@/lib/typography';

type PreviewKind = 'iframe' | 'document' | 'empty' | 'description';

export interface PreviewProps {
  /** The title the founder sees as the caption beneath the preview card. */
  title: string;
  /** Used to pick the preview kind heuristically. */
  classifierTitle: string;
  /** Short blurb shown in the description fallback. */
  description?: string | null;
  /** Production URL from CoreMemory.production_url (if any). */
  productionUrl?: string | null;
  /** Document content (markdown) if the task points at a doc. */
  documentContent?: string | null;
  /** Document title (e.g. "Brand kit"). */
  documentTitle?: string | null;
}

const BUILD_KEYWORDS = ['deploy', 'ship', 'build', 'website', 'landing', 'app'];
const DOC_KEYWORDS = ['logo', 'brand', 'pitch', 'deck', 'doc', 'copy', 'wordmark', 'sentence'];

export function pickPreviewKind(opts: {
  classifierTitle: string;
  productionUrl?: string | null;
  documentContent?: string | null;
}): PreviewKind {
  const t = opts.classifierTitle.toLowerCase();
  const isBuild = BUILD_KEYWORDS.some((k) => t.includes(k));
  if (isBuild) {
    return opts.productionUrl ? 'iframe' : 'empty';
  }
  const isDoc = DOC_KEYWORDS.some((k) => t.includes(k));
  if (isDoc && opts.documentContent && opts.documentContent.trim().length > 0) {
    return 'document';
  }
  return 'description';
}

export function TaskContentPreview({
  title,
  classifierTitle,
  description,
  productionUrl,
  documentContent,
  documentTitle,
}: PreviewProps) {
  const kind = pickPreviewKind({
    classifierTitle,
    productionUrl,
    documentContent,
  });

  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <div className="relative flex-1 overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
        {/* Inset badge */}
        <div className="absolute left-4 top-4 z-10">
          <span className={cn(MONO_CHIP, 'rounded-full border border-slate-200 bg-white px-2 py-1 text-slate-700')}>
            {badgeFor(kind, classifierTitle)}
          </span>
        </div>

        {kind === 'iframe' && productionUrl ? (
          <iframe
            data-testid="content-preview-iframe"
            src={productionUrl}
            title={title}
            className="h-full w-full border-0"
          />
        ) : kind === 'document' ? (
          <DocumentBody
            content={documentContent ?? ''}
            heading={documentTitle ?? title}
          />
        ) : kind === 'empty' ? (
          <EmptyState />
        ) : (
          <DescriptionBody title={title} description={description ?? ''} />
        )}
      </div>

      <p
        className={cn(SERIF_CARD, 'text-slate-800')}
        data-testid="content-preview-caption"
      >
        {title}
      </p>
    </div>
  );
}

function badgeFor(kind: PreviewKind, title: string): string {
  if (kind === 'iframe') return 'Landing page';
  if (kind === 'document') return 'Document';
  if (kind === 'empty') return 'Preview';
  // Lowercase per stylesheet; pull a short word from the title.
  return title.split(/\s+/)[0]?.toLowerCase() ?? 'preview';
}

function EmptyState() {
  return (
    <div className="flex h-full w-full items-center justify-center px-8 text-center">
      <div className="max-w-sm space-y-2">
        <p className="text-[14px] font-medium text-slate-900">Nothing to preview yet.</p>
        <p className="text-[13px] text-slate-500">
          Connect Vercel to see the live build here, or start with the chat on the right.
        </p>
      </div>
    </div>
  );
}

function DocumentBody({ content, heading }: { content: string; heading: string }) {
  return (
    <div className="h-full w-full overflow-y-auto px-8 pb-8 pt-16">
      <div className="mx-auto max-w-[640px] space-y-4">
        <h2 className={cn(SERIF_CARD, 'text-[20px] text-slate-900')}>{heading}</h2>
        <pre className="whitespace-pre-wrap font-sans text-[14px] leading-[1.6] text-slate-700">
          {content}
        </pre>
      </div>
    </div>
  );
}

function DescriptionBody({ title, description }: { title: string; description: string }) {
  return (
    <div className="h-full w-full overflow-y-auto px-8 pb-8 pt-16">
      <div className="mx-auto max-w-[640px] space-y-3">
        <h2 className={cn(SERIF_CARD, 'text-[20px] text-slate-900')}>{title}</h2>
        {description.trim().length > 0 ? (
          <p className="text-[14px] leading-[1.6] text-slate-700">{description}</p>
        ) : (
          <p className="text-[13px] text-slate-500">
            Nothing to preview yet. Start with the chat on the right.
          </p>
        )}
      </div>
    </div>
  );
}
