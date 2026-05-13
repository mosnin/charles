import Link from 'next/link';
import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { Sapling } from '@/components/canvas/sapling';
import { BrandLogo } from '@/components/brand-logo';
import {
  BODY_MUTED,
  MONO_CHIP,
  PRIMARY_PILL,
  SERIF_DISPLAY,
} from '@/lib/typography';
import { cn } from '@/lib/utils';

/**
 * `/` — the Charles landing page.
 *
 * Authenticated users are sent to their workspace. Everyone else sees the
 * one-page pitch. Polish pass: Newsreader serif on the hero, sapling next
 * to the wordmark, pill CTAs that match `/sign-in`. No carousels, no
 * testimonials, no gradients, no glow.
 */
export default async function HomePage() {
  const { userId } = await auth();

  if (userId) {
    redirect('/auth/redirect');
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="mx-auto flex max-w-[960px] items-center justify-between px-6 pt-10 md:pt-14">
        <div className="flex items-center gap-2">
          <Sapling size={24} />
          <BrandLogo className="text-xl" alt="Charles" />
        </div>
        <Link
          href="/sign-in"
          className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          Sign in
        </Link>
      </header>

      <section className="mx-auto max-w-[960px] px-6 pt-24 pb-32 md:pt-32 md:pb-40">
        <span className={cn(MONO_CHIP, 'text-muted-foreground')}>
          ai cofounder · v1
        </span>
        <h1
          className={cn(
            SERIF_DISPLAY,
            'mt-4 max-w-[860px] text-5xl leading-[1.05] md:text-6xl',
          )}
        >
          Charles is your AI cofounder.
        </h1>
        <p
          className={cn(
            BODY_MUTED,
            'mt-6 max-w-[680px] text-lg leading-[1.5] md:text-xl',
          )}
        >
          A manager agent that runs an entire company across engineering, sales,
          marketing, design, support, and Ops/Finance. So a solo founder can ship
          from idea to revenue without hiring.
        </p>
        <div className="mt-10 flex items-center gap-3">
          <Link href="/sign-up" className={cn(PRIMARY_PILL, 'h-11 px-7')}>
            Start building
          </Link>
          <Link
            href="/sign-in"
            className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            I have an account
          </Link>
        </div>
      </section>

      <section className="mx-auto max-w-[760px] space-y-24 px-6 pb-32">
        <div>
          <h2 className={cn(SERIF_DISPLAY, 'text-2xl md:text-[28px]')}>
            One manager. Six departments.
          </h2>
          <p className="mt-4 text-base leading-[1.5] text-muted-foreground">
            Charles is the manager. Underneath Charles sit engineering, sales,
            marketing, design, support, and Ops/Finance. You talk to one agent.
            Charles assigns the work, holds the context, and reports back when
            a decision is yours to make.
          </p>
        </div>

        <div>
          <h2 className={cn(SERIF_DISPLAY, 'text-2xl md:text-[28px]')}>
            Memory that holds.
          </h2>
          <p className="mt-4 text-base leading-[1.5] text-muted-foreground">
            Charles remembers what your product is, who you have spoken to,
            what you decided last week, and why. The longer you build together,
            the sharper he gets. Nothing resets between sessions.
          </p>
        </div>

        <div>
          <h2 className={cn(SERIF_DISPLAY, 'text-2xl md:text-[28px]')}>
            Approval, not autopilot.
          </h2>
          <p className="mt-4 text-base leading-[1.5] text-muted-foreground">
            Charles drafts, plans, and proposes. You approve before anything
            ships, sends, or spends. The approval banner is the contract — clear
            summary, clear risk level, two buttons. You stay in control.
          </p>
        </div>

        <div>
          <h2 className={cn(SERIF_DISPLAY, 'text-2xl md:text-[28px]')}>
            From idea to revenue.
          </h2>
          <p className="mt-4 text-base leading-[1.5] text-muted-foreground">
            Six stages, in order. Idea, Initial, Identity, Building, Selling,
            Scaling. Charles meets you where you are and walks the company
            forward one stage at a time.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-[960px] px-6 pb-32 text-center">
        <Link href="/sign-up" className={cn(PRIMARY_PILL, 'h-11 px-7')}>
          Start building
        </Link>
      </section>

      <footer className="border-t border-border/60">
        <div className="mx-auto flex max-w-[960px] items-center justify-between px-6 py-8 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <Sapling size={20} />
            <BrandLogo className="text-sm" alt="Charles" />
          </div>
          <span>&copy; {new Date().getFullYear()} Charles</span>
        </div>
      </footer>
    </main>
  );
}
