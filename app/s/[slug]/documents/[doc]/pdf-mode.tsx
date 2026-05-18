'use client';

/**
 * Print-ready preview.
 *
 * Renders the markdown as styled HTML inside a letter-sized sheet. The PDF
 * itself comes from the browser's print dialog (Save as PDF) — no extra
 * dependency, no server-side renderer, no canvas hacks.
 *
 * On screen: a cream sheet at 8.5in × auto, serif body, drop shadow.
 * On print: the page chrome (breadcrumb, pills, button) is hidden by
 * print:hidden utilities, and the sheet expands to fill the page.
 */

import { Printer } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { cn } from '@/lib/utils';
import { CAPTION } from '@/lib/typography';

interface PdfModeProps {
  title: string;
  content: string;
}

export function PdfMode({ title, content }: PdfModeProps) {
  function print() {
    window.print();
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3 print:hidden">
        <p className={CAPTION}>
          Use your browser&apos;s print dialog to save this as a PDF.
        </p>
        <button
          type="button"
          onClick={print}
          className={cn(
            'inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-sm transition-colors duration-150',
            'bg-foreground text-background hover:bg-foreground/90',
          )}
        >
          <Printer size={13} />
          Print or save as PDF
        </button>
      </div>

      <div
        className={cn(
          // Screen: letter sheet, drop shadow, centered.
          'mx-auto bg-white text-neutral-900',
          'shadow-[0_2px_24px_rgba(0,0,0,0.08)]',
          'border border-border/70',
          'max-w-[8.5in] w-full',
          'px-[1in] py-[1in]',
          // Print: full bleed, no shadow.
          'print:max-w-none print:w-auto print:shadow-none print:border-0 print:p-0 print:bg-white',
        )}
        style={{
          fontFamily:
            "'Charter', 'Iowan Old Style', 'Georgia', 'Times New Roman', serif",
        }}
      >
        <h1
          className="mb-6 text-[28px] font-semibold leading-tight text-neutral-900"
          style={{ letterSpacing: '-0.01em' }}
        >
          {title}
        </h1>
        <article
          className={cn(
            'text-[16px] leading-[1.7]',
            '[&_h1]:mt-8 [&_h1]:mb-3 [&_h1]:text-[22px] [&_h1]:font-semibold',
            '[&_h2]:mt-7 [&_h2]:mb-2 [&_h2]:text-[18px] [&_h2]:font-semibold',
            '[&_h3]:mt-6 [&_h3]:mb-2 [&_h3]:text-[16px] [&_h3]:font-semibold',
            '[&_p]:my-3',
            '[&_ul]:my-3 [&_ul]:pl-6 [&_ul]:list-disc',
            '[&_ol]:my-3 [&_ol]:pl-6 [&_ol]:list-decimal',
            '[&_li]:my-1',
            '[&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:border-neutral-300 [&_blockquote]:pl-4 [&_blockquote]:text-neutral-600',
            '[&_a]:underline [&_a]:text-neutral-900',
            '[&_hr]:my-6 [&_hr]:border-neutral-200',
            '[&_code]:bg-neutral-100 [&_code]:rounded [&_code]:px-1 [&_code]:py-0.5',
            '[&_pre]:bg-neutral-100 [&_pre]:rounded [&_pre]:p-3 [&_pre]:my-4',
          )}
        >
          {content ? (
            <ReactMarkdown>{content}</ReactMarkdown>
          ) : (
            <p className="text-neutral-500">Nothing here yet.</p>
          )}
        </article>
      </div>

      {/* Print-only nudges. Tailwind's print: utilities cover most cases, but
          we also need to hide the workspace shell when the user prints. */}
      <style jsx global>{`
        @media print {
          @page {
            size: letter;
            margin: 0.75in;
          }
          html,
          body {
            background: white !important;
          }
        }
      `}</style>
    </section>
  );
}
