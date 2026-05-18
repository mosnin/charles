/**
 * Charles auth shell — the visual frame for `/sign-in` and `/sign-up`.
 *
 * Two-column layout on desktop; single column on mobile.
 *
 * - Left half (~45%): focal card. Sapling mascot, serif headline, single
 *   subhead line, then the Clerk component (passed in as `children`).
 * - Right half (~55%): a quiet display surface — dotted grid, a centered
 *   pull quote in serif, a small mono "charles.dev" chip in the corner.
 *
 * Server component. The Clerk component lives in `children` and brings its
 * own client boundary.
 *
 * Per CLAUDE.md: this is a first-impression surface, so it earns the canvas
 * typography helpers (SERIF_DISPLAY, MONO_CHIP, MONO_META) from lib/typography.
 */

import { Sapling } from '@/components/canvas/sapling';
import { GridBackground } from '@/components/canvas/grid-background';
import {
  SERIF_DISPLAY,
  MONO_CHIP,
  MONO_META,
  BODY_MUTED,
} from '@/lib/typography';
import { cn } from '@/lib/utils';

interface Props {
  heading: string;
  subheading: string;
  children: React.ReactNode;
}

export function CharlesAuthShell({ heading, subheading, children }: Props) {
  return (
    <main className="relative min-h-screen w-full overflow-hidden bg-background text-foreground">
      <GridBackground />

      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-[1400px] flex-col md:flex-row">
        {/* ── Left: focal card ──────────────────────────────────────── */}
        <section
          className="flex w-full flex-col items-center justify-center px-6 py-16 md:w-[45%] md:px-12 md:py-24"
          aria-labelledby="auth-heading"
        >
          <div className="w-full max-w-sm">
            <div className="mb-6 flex items-center gap-2">
              <Sapling size={48} />
            </div>

            <h1
              id="auth-heading"
              className={cn(SERIF_DISPLAY, 'text-4xl text-foreground')}
            >
              {heading}
            </h1>

            <p className={cn(BODY_MUTED, 'mt-3 text-base')}>{subheading}</p>

            <div className="mt-8 w-full">{children}</div>
          </div>
        </section>

        {/* ── Right: quiet display surface (hidden on mobile) ───────── */}
        <aside
          aria-hidden
          className="relative hidden flex-1 border-l border-border/60 md:flex md:items-center md:justify-center"
        >
          <div className="relative z-10 mx-auto max-w-md px-12 text-center">
            <p
              className={cn(
                SERIF_DISPLAY,
                'text-2xl leading-snug text-foreground/80 md:text-[28px]',
              )}
            >
              Ship from idea to revenue without hiring.
            </p>
            <p className={cn(MONO_META, 'mt-4 uppercase tracking-wide')}>
              — Charles, your AI cofounder
            </p>
          </div>

          <span
            className={cn(
              MONO_CHIP,
              'absolute bottom-6 right-6 text-muted-foreground',
            )}
          >
            charles.dev
          </span>
        </aside>
      </div>
    </main>
  );
}
