import Link from 'next/link';
import { Sapling } from '@/components/canvas/sapling';
import { BrandLogo } from '@/components/brand-logo';
import { SERIF_DISPLAY } from '@/lib/typography';
import { cn } from '@/lib/utils';

export const metadata = {
  title: 'Terms — Charles',
  description: 'The agreement between you and Charles. Plain English.',
};

const LAST_UPDATED = 'May 14, 2026';

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="mx-auto flex max-w-[760px] items-center justify-between px-6 pt-10 md:pt-14">
        <Link href="/" className="flex items-center gap-2">
          <Sapling size={24} />
          <BrandLogo className="text-xl" alt="Charles" />
        </Link>
        <Link
          href="/sign-in"
          className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          Sign in
        </Link>
      </header>

      <article className="mx-auto max-w-[680px] px-6 pt-20 pb-32 md:pt-28">
        <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
          Terms of service · last updated {LAST_UPDATED}
        </p>
        <h1 className={cn(SERIF_DISPLAY, 'mt-3 text-4xl leading-[1.05] md:text-5xl')}>
          The agreement.
        </h1>
        <p className="mt-6 text-lg leading-[1.55] text-muted-foreground">
          By using Charles you agree to these terms. We wrote them in plain
          English on purpose — if anything is unclear, write to{' '}
          <a href="mailto:hello@charles.app" className="underline underline-offset-4">
            hello@charles.app
          </a>{' '}
          and we&apos;ll explain.
        </p>

        <section className="mt-14 space-y-6 leading-[1.65]">
          <h2 className={cn(SERIF_DISPLAY, 'text-2xl md:text-[26px]')}>What Charles is</h2>
          <p className="text-base text-muted-foreground">
            Charles is an AI-powered founder OS. A manager agent that coordinates
            sub-agents across engineering, sales, marketing, design, support, and
            ops/finance. You talk to Charles. Charles proposes work. You approve
            before anything is sent, shipped, or spent.
          </p>
          <p className="text-base text-muted-foreground">
            Charles will sometimes be wrong. AI models hallucinate. You are the
            judgement layer. We&apos;ll do our best to make the agent safe to trust;
            you stay responsible for what ships out the door.
          </p>
        </section>

        <section className="mt-14 space-y-6 leading-[1.65]">
          <h2 className={cn(SERIF_DISPLAY, 'text-2xl md:text-[26px]')}>Your account</h2>
          <p className="text-base text-muted-foreground">
            One person per account. Keep your sign-in secure. Tell us at{' '}
            <a href="mailto:hello@charles.app" className="underline underline-offset-4">
              hello@charles.app
            </a>{' '}
            if you think someone else got into your account so we can lock it.
          </p>
          <p className="text-base text-muted-foreground">
            You must be 16 or older to use Charles. If you&apos;re acting on behalf
            of a company, you confirm you have the authority to bind that
            company to these terms.
          </p>
        </section>

        <section className="mt-14 space-y-6 leading-[1.65]">
          <h2 className={cn(SERIF_DISPLAY, 'text-2xl md:text-[26px]')}>Acceptable use</h2>
          <p className="text-base text-muted-foreground">
            Don&apos;t use Charles to harm people, break laws, send spam, scrape
            third-party sites at scale, or generate content that targets,
            defrauds, or impersonates someone.
          </p>
          <p className="text-base text-muted-foreground">
            Don&apos;t try to extract Charles&apos;s system prompts, jailbreak the agent
            into bypassing approvals, or use the product to build a competing
            agent system on top of our models. If you&apos;re here to study how it
            works, just ask us — we&apos;d rather talk.
          </p>
        </section>

        <section className="mt-14 space-y-6 leading-[1.65]">
          <h2 className={cn(SERIF_DISPLAY, 'text-2xl md:text-[26px]')}>Your content</h2>
          <p className="text-base text-muted-foreground">
            What you create in Charles — messages, tasks, documents, brand
            assets — belongs to you. You grant us a limited license to store,
            process, and serve that content back to you so the product works.
            That license ends when you delete the content or the account.
          </p>
          <p className="text-base text-muted-foreground">
            We do not use your content to train any model. See the{' '}
            <Link href="/legal/privacy" className="underline underline-offset-4">
              Privacy policy
            </Link>{' '}
            for the full picture.
          </p>
        </section>

        <section className="mt-14 space-y-6 leading-[1.65]">
          <h2 className={cn(SERIF_DISPLAY, 'text-2xl md:text-[26px]')}>AI-generated output</h2>
          <p className="text-base text-muted-foreground">
            Outputs from Charles are AI-generated. They may be wrong, biased, or
            made up. You are responsible for what you do with them — what you
            send to customers, post publicly, file with regulators, or commit to
            in writing.
          </p>
          <p className="text-base text-muted-foreground">
            We don&apos;t guarantee accuracy, originality, or non-infringement of
            generated content. Treat Charles like a sharp first-year analyst:
            useful, fast, capable of being confidently wrong.
          </p>
        </section>

        <section className="mt-14 space-y-6 leading-[1.65]">
          <h2 className={cn(SERIF_DISPLAY, 'text-2xl md:text-[26px]')}>Payment</h2>
          <p className="text-base text-muted-foreground">
            If you&apos;re on a paid plan, fees are billed in advance through Stripe
            and are non-refundable except where required by law. Cancel anytime
            from settings; your plan keeps working until the end of the current
            period.
          </p>
        </section>

        <section className="mt-14 space-y-6 leading-[1.65]">
          <h2 className={cn(SERIF_DISPLAY, 'text-2xl md:text-[26px]')}>Termination</h2>
          <p className="text-base text-muted-foreground">
            You can quit anytime — delete your account from settings. We can
            suspend or terminate accounts that violate these terms or put the
            product, other users, or our service providers at risk. If we
            terminate you, we&apos;ll tell you why.
          </p>
        </section>

        <section className="mt-14 space-y-6 leading-[1.65]">
          <h2 className={cn(SERIF_DISPLAY, 'text-2xl md:text-[26px]')}>Liability</h2>
          <p className="text-base text-muted-foreground">
            Charles is provided &ldquo;as-is.&rdquo; To the maximum extent allowed by
            law, we disclaim implied warranties (merchantability, fitness for a
            particular purpose, non-infringement).
          </p>
          <p className="text-base text-muted-foreground">
            Our total liability to you for any claim relating to Charles is
            capped at the greater of (a) the fees you paid us in the twelve
            months before the claim, or (b) one hundred US dollars. We are not
            liable for indirect, incidental, or consequential damages.
          </p>
          <p className="text-base text-muted-foreground">
            None of this limits liability we cannot legally limit (fraud, gross
            negligence, statutory consumer rights, and so on).
          </p>
        </section>

        <section className="mt-14 space-y-6 leading-[1.65]">
          <h2 className={cn(SERIF_DISPLAY, 'text-2xl md:text-[26px]')}>Changes</h2>
          <p className="text-base text-muted-foreground">
            We may update these terms. If we change them in a way that
            materially affects you, we&apos;ll email you before the change takes
            effect. Continuing to use Charles after the change means you accept
            the new terms.
          </p>
        </section>

        <section className="mt-14 space-y-6 leading-[1.65]">
          <h2 className={cn(SERIF_DISPLAY, 'text-2xl md:text-[26px]')}>Governing law</h2>
          <p className="text-base text-muted-foreground">
            These terms are governed by the laws of the State of Delaware,
            United States, without regard to conflict-of-law rules. Disputes are
            resolved in the state or federal courts located in Delaware, and you
            consent to jurisdiction there.
          </p>
        </section>

        <section className="mt-14 space-y-6 leading-[1.65]">
          <h2 className={cn(SERIF_DISPLAY, 'text-2xl md:text-[26px]')}>Contact</h2>
          <p className="text-base text-muted-foreground">
            Anything about these terms:{' '}
            <a href="mailto:hello@charles.app" className="underline underline-offset-4">
              hello@charles.app
            </a>
            .
          </p>
        </section>
      </article>

      <footer className="border-t border-border/60">
        <div className="mx-auto flex max-w-[760px] items-center justify-between px-6 py-8 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <Sapling size={20} />
            <BrandLogo className="text-sm" alt="Charles" />
          </div>
          <Link href="/legal/privacy" className="hover:text-foreground transition-colors">
            Privacy
          </Link>
        </div>
      </footer>
    </main>
  );
}
