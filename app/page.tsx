import Link from 'next/link';
import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { BrandLogo } from '@/components/brand-logo';

/**
 * `/` — the Charles landing page.
 *
 * Authenticated users are sent to their workspace. Everyone else sees the
 * one-page pitch. No carousels, no testimonials, no gradients, no glow.
 */
export default async function HomePage() {
  const { userId } = await auth();

  if (userId) {
    redirect('/auth/redirect');
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="mx-auto flex max-w-[960px] items-center justify-between px-6 pt-10 md:pt-14">
        <BrandLogo className="text-xl" alt="Charles" />
        <Link
          href="/sign-in"
          className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          Sign in
        </Link>
      </header>

      <section className="mx-auto max-w-[960px] px-6 pt-24 pb-32 md:pt-32 md:pb-40">
        <h1 className="max-w-[860px] text-4xl font-semibold leading-[1.1] tracking-tight md:text-5xl">
          Charles is your AI cofounder.
        </h1>
        <p className="mt-6 max-w-[680px] text-lg leading-[1.5] text-muted-foreground md:text-xl">
          A manager agent that runs an entire company across engineering, sales,
          marketing, design, support, and Ops/Finance, so a solo founder can ship from
          idea to revenue without hiring.
        </p>
        <div className="mt-10">
          <Link
            href="/sign-up"
            className="inline-flex h-11 items-center justify-center rounded-lg bg-foreground px-6 text-sm font-medium text-background transition-opacity hover:opacity-90"
          >
            Start building
          </Link>
        </div>
      </section>

      <section className="mx-auto max-w-[760px] space-y-24 px-6 pb-32">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight md:text-[28px]">
            One manager. Six departments.
          </h2>
          <p className="mt-4 text-base leading-[1.5] text-muted-foreground">
            Charles is the manager. Underneath Charles sit engineering, sales,
            marketing, design, support, and Ops/Finance. You talk to one agent. Charles
            assigns the work, holds the context, and reports back when a
            decision is yours to make.
          </p>
        </div>

        <div>
          <h2 className="text-2xl font-semibold tracking-tight md:text-[28px]">
            Memory that holds.
          </h2>
          <p className="mt-4 text-base leading-[1.5] text-muted-foreground">
            Charles remembers what your product is, who you have spoken to, what
            you decided last week, and why. The longer you build together, the
            sharper he gets. Nothing resets between sessions.
          </p>
        </div>

        <div>
          <h2 className="text-2xl font-semibold tracking-tight md:text-[28px]">
            Approval, not autopilot.
          </h2>
          <p className="mt-4 text-base leading-[1.5] text-muted-foreground">
            Charles drafts, plans, and proposes. You approve before anything
            ships, sends, or spends. The approval banner is the contract — clear
            summary, clear risk level, two buttons. You stay in control.
          </p>
        </div>

        <div>
          <h2 className="text-2xl font-semibold tracking-tight md:text-[28px]">
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
        <Link
          href="/sign-up"
          className="inline-flex h-11 items-center justify-center rounded-lg bg-foreground px-6 text-sm font-medium text-background transition-opacity hover:opacity-90"
        >
          Start building
        </Link>
      </section>

      <footer className="border-t border-border/60">
        <div className="mx-auto flex max-w-[960px] items-center justify-between px-6 py-8 text-sm text-muted-foreground">
          <BrandLogo className="text-sm" alt="Charles" />
          <span>&copy; {new Date().getFullYear()} Charles</span>
        </div>
      </footer>
    </main>
  );
}
