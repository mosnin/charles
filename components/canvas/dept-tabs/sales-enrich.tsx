'use client';

/**
 * Sales › Enrich contacts — the email preview card.
 *
 * Pixel-clone of cofounder.co's Sales / Enrich screen. One focal element:
 * a rounded card with a Gmail glyph + To / From / Subject headers and a
 * body that fades at the bottom. Left/right arrows cycle through canned
 * previews. A monospace carousel chip pages the underlying campaign.
 *
 * Charles does not have an enrichment pipeline yet — the previews are
 * canned. When we wire Apollo / Clearbit, swap the constant for real data
 * via props; the card layout doesn't change.
 */

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { SERIF_CARD, SERIF_FONT_STYLE } from '@/lib/typography';
import { CarouselChip } from '../carousel-chip';

interface EmailPreview {
  to: string;
  from: string;
  subject: string;
  body: string;
}

const PREVIEWS: readonly EmailPreview[] = [
  {
    to: 'maria.chen@northstar.io',
    from: 'you@yourdomain.com',
    subject: 'Quick question about Northstar onboarding',
    body:
      'Hi Maria,\n\nI noticed Northstar shipped your founder-onboarding flow last month. The order of the steps is the part most teams get wrong, and yours reads cleanly. I am building a tool for solo founders that handles the boring half of a company — outbound, follow-up, the inbox — and I wanted to ask one question about how you sequenced the first call.\n\nFifteen minutes next week?\n\n— You',
  },
  {
    to: 'devin@signalpath.com',
    from: 'you@yourdomain.com',
    subject: 'Following up on Signalpath',
    body:
      'Devin,\n\nWe spoke briefly at the AI Tinkerers event in March. I have been thinking about the agent-routing problem you described — the part where your sub-agents stall waiting on each other.\n\nI am running a small private beta of Charles that handles that problem differently. Worth a 20-minute look?\n\n— You',
  },
  {
    to: 'priya@kindredops.com',
    from: 'you@yourdomain.com',
    subject: 'Kindred + Charles — short intro',
    body:
      'Priya,\n\nKindredOps and Charles overlap on the founder-tooling space but solve different halves. You are after the team layer; we are after the solo founder. I think there is one obvious referral path between the two.\n\nFifteen minutes to compare notes?\n\n— You',
  },
];

export function SalesEnrich() {
  const [index, setIndex] = useState(0);
  const total = PREVIEWS.length;
  const preview = PREVIEWS[index];

  const prev = () => setIndex((i) => (i - 1 + total) % total);
  const next = () => setIndex((i) => (i + 1) % total);

  return (
    <section className="flex flex-col items-center gap-6" data-testid="sales-enrich">
      <div className="flex w-full max-w-2xl items-stretch gap-3">
        <button
          type="button"
          aria-label="Previous preview"
          onClick={prev}
          className="flex w-8 flex-shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-slate-50 hover:text-slate-900 transition-colors duration-150"
        >
          {'<'}
        </button>

        <article className="relative flex-1 overflow-hidden rounded-2xl border border-slate-200 bg-white">
          {/* Card header — Gmail glyph + envelope copy */}
          <header className="flex items-start gap-3 border-b border-slate-100 px-6 py-4">
            <GmailGlyph className="h-7 w-7 flex-shrink-0" />
            <div className="min-w-0 flex-1 space-y-1">
              <Field label="To" value={preview.to} />
              <Field label="From" value={preview.from} />
              <Field label="Subject" value={preview.subject} bold />
            </div>
          </header>

          {/* Body — fades at the bottom */}
          <div className="relative">
            <div className="px-6 py-5 text-[14px] leading-6 text-slate-800 whitespace-pre-wrap">
              {preview.body}
            </div>
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-white to-transparent"
            />
          </div>
        </article>

        <button
          type="button"
          aria-label="Next preview"
          onClick={next}
          className="flex w-8 flex-shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-slate-50 hover:text-slate-900 transition-colors duration-150"
        >
          {'>'}
        </button>
      </div>

      <CarouselChip
        label="Sales outreach campaign"
        index={index}
        total={total}
        onPrev={prev}
        onNext={next}
      />
    </section>
  );
}

function Field({
  label,
  value,
  bold = false,
}: {
  label: string;
  value: string;
  bold?: boolean;
}) {
  return (
    <div className="flex items-baseline gap-2 text-[13px]">
      <span className="w-14 flex-shrink-0 text-slate-400">{label}</span>
      <span
        className={cn(
          'truncate',
          bold ? 'font-semibold text-slate-900' : 'text-slate-700',
        )}
        style={bold ? SERIF_FONT_STYLE : undefined}
      >
        {bold ? <span className={SERIF_CARD}>{value}</span> : value}
      </span>
    </div>
  );
}

function GmailGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect x="2" y="5" width="20" height="14" rx="2" fill="#fff" stroke="#e2e8f0" />
      <path d="M3 6.5l9 6.5 9-6.5" fill="none" stroke="#cbd5e1" strokeWidth="1.5" />
      <path d="M2 6l10 7 10-7v1.2l-10 7-10-7z" fill="#ea4335" opacity="0.85" />
    </svg>
  );
}
