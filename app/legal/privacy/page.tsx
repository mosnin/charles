import Link from 'next/link';
import { Sapling } from '@/components/canvas/sapling';
import { BrandLogo } from '@/components/brand-logo';
import { SERIF_DISPLAY } from '@/lib/typography';
import { cn } from '@/lib/utils';

export const metadata = {
  title: 'Privacy — Charles',
  description: 'How Charles handles your data. Short, honest, real.',
};

const LAST_UPDATED = 'May 14, 2026';

export default function PrivacyPage() {
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
          Privacy · last updated {LAST_UPDATED}
        </p>
        <h1 className={cn(SERIF_DISPLAY, 'mt-3 text-4xl leading-[1.05] md:text-5xl')}>
          What we do with your data.
        </h1>
        <p className="mt-6 text-lg leading-[1.55] text-muted-foreground">
          A plain-English summary of how Charles handles the things you tell it.
          Read it. If anything looks wrong or surprises you, write to{' '}
          <a href="mailto:hello@charles.app" className="underline underline-offset-4">
            hello@charles.app
          </a>{' '}
          before you sign up.
        </p>

        <section className="mt-14 space-y-6 leading-[1.65]">
          <h2 className={cn(SERIF_DISPLAY, 'text-2xl md:text-[26px]')}>What we collect</h2>
          <p className="text-base text-muted-foreground">
            <span className="text-foreground">Account.</span> Your name and email
            address, from Clerk, when you sign up.
          </p>
          <p className="text-base text-muted-foreground">
            <span className="text-foreground">What you tell Charles.</span> The
            messages, tasks, documents, and notes you create inside the product.
            Charles needs these to be useful — that&apos;s the whole job.
          </p>
          <p className="text-base text-muted-foreground">
            <span className="text-foreground">Usage signals.</span> Which features
            you open, what errors happen, basic performance numbers. We use this
            to find and fix what&apos;s broken. We do not build profiles of you.
          </p>
          <p className="text-base text-muted-foreground">
            <span className="text-foreground">What we don&apos;t collect.</span>{' '}
            Payment card numbers (those live with Stripe). Anything from your
            connected tools we don&apos;t need to run the agent. Anything we don&apos;t
            need.
          </p>
        </section>

        <section className="mt-14 space-y-6 leading-[1.65]">
          <h2 className={cn(SERIF_DISPLAY, 'text-2xl md:text-[26px]')}>How AI models use it</h2>
          <p className="text-base text-muted-foreground">
            Your conversations are sent to{' '}
            <span className="text-foreground">OpenAI&apos;s API</span> so Charles can
            answer. OpenAI does not train its models on API data — that&apos;s their
            written commitment. We don&apos;t train any model on your data either.
            Ever.
          </p>
          <p className="text-base text-muted-foreground">
            Charles also generates embeddings of your content so it can recall
            relevant context across conversations. Those embeddings live in your
            own workspace — not pooled, not shared.
          </p>
        </section>

        <section className="mt-14 space-y-6 leading-[1.65]">
          <h2 className={cn(SERIF_DISPLAY, 'text-2xl md:text-[26px]')}>Who we share with</h2>
          <p className="text-base text-muted-foreground">
            Only the service providers we need to run the product:
          </p>
          <ul className="space-y-2 pl-5 text-base text-muted-foreground [&>li]:list-disc">
            <li><span className="text-foreground">Supabase</span> — database + file storage</li>
            <li><span className="text-foreground">Clerk</span> — sign-in and account management</li>
            <li><span className="text-foreground">OpenAI</span> — model inference for chat</li>
            <li><span className="text-foreground">Modal</span> — running the agent</li>
            <li><span className="text-foreground">Vercel</span> — hosting the web app</li>
            <li><span className="text-foreground">Upstash</span> — rate limiting + short-lived state</li>
            <li><span className="text-foreground">Stripe</span> — payments, if you subscribe</li>
          </ul>
          <p className="text-base text-muted-foreground">
            We do not sell your data. We do not share it with advertisers. We do
            not let other customers see what&apos;s in your workspace.
          </p>
        </section>

        <section className="mt-14 space-y-6 leading-[1.65]">
          <h2 className={cn(SERIF_DISPLAY, 'text-2xl md:text-[26px]')}>Your rights</h2>
          <p className="text-base text-muted-foreground">
            <span className="text-foreground">Export.</span> You can ask for a copy
            of your workspace data at any time. We respond within 30 days.
          </p>
          <p className="text-base text-muted-foreground">
            <span className="text-foreground">Delete.</span> Delete your account
            from settings and your data is removed from our active systems within
            30 days, from backups within 90.
          </p>
          <p className="text-base text-muted-foreground">
            <span className="text-foreground">Object, correct, restrict.</span> If
            you&apos;re in the EU, UK, or California, you have rights under GDPR /
            CCPA. Write to{' '}
            <a href="mailto:hello@charles.app" className="underline underline-offset-4">
              hello@charles.app
            </a>{' '}
            and we&apos;ll handle it.
          </p>
        </section>

        <section className="mt-14 space-y-6 leading-[1.65]">
          <h2 className={cn(SERIF_DISPLAY, 'text-2xl md:text-[26px]')}>Security</h2>
          <p className="text-base text-muted-foreground">
            Data is encrypted in transit (TLS) and at rest. Access is gated by
            row-level security in the database. We don&apos;t store passwords —
            Clerk does that.
          </p>
          <p className="text-base text-muted-foreground">
            No system is invincible. If we ever have a breach that affects your
            data, we&apos;ll tell you — quickly, in plain English, by email.
          </p>
        </section>

        <section className="mt-14 space-y-6 leading-[1.65]">
          <h2 className={cn(SERIF_DISPLAY, 'text-2xl md:text-[26px]')}>Children</h2>
          <p className="text-base text-muted-foreground">
            Charles is for adults running companies. We don&apos;t knowingly serve
            anyone under 16.
          </p>
        </section>

        <section className="mt-14 space-y-6 leading-[1.65]">
          <h2 className={cn(SERIF_DISPLAY, 'text-2xl md:text-[26px]')}>Changes</h2>
          <p className="text-base text-muted-foreground">
            If we change this policy in a way that matters, we&apos;ll email you
            before the change takes effect. Small clarifications get a new
            &ldquo;last updated&rdquo; date and that&apos;s it.
          </p>
        </section>

        <section className="mt-14 space-y-6 leading-[1.65]">
          <h2 className={cn(SERIF_DISPLAY, 'text-2xl md:text-[26px]')}>Contact</h2>
          <p className="text-base text-muted-foreground">
            Anything about your data:{' '}
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
          <Link href="/legal/terms" className="hover:text-foreground transition-colors">
            Terms
          </Link>
        </div>
      </footer>
    </main>
  );
}
