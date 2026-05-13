import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import { getSpaceFromSlug } from '@/lib/space';
import {
  computeOverview,
  loadResendCampaigns,
  loadLoopsCampaigns,
  type CampaignSummary,
  type CampaignsOverview,
  type Provider,
} from '@/lib/email-campaigns/rollup';
import {
  H1,
  H2,
  TITLE_FONT,
  BODY,
  BODY_MUTED,
  CAPTION,
  SECTION_LABEL,
  STAT_NUMBER_COMPACT,
  PAGE_RHYTHM,
  READING_MAX,
} from '@/lib/typography';

/**
 * Email campaigns — what you sent, and how it landed.
 *
 * One page, one question: did the email work. Overview on top
 * (sent / delivered / opened / clicked), then 50 most-recent campaigns
 * across Resend + Loops with relative open-rate bars. No filters,
 * no tabs, no settings — pick a sane window (30 days) and show it.
 *
 * Defensive: each provider load is independent via Promise.allSettled.
 * Both empty → empty state. Both failed → empty state + chip.
 */

const PROVIDER_LABEL: Record<Provider, string> = {
  resend: 'Resend',
  loops: 'Loops',
};

function pct(n: number): string {
  if (!isFinite(n) || n <= 0) return '0%';
  return `${Math.round(n * 100)}%`;
}

function pctOf(n: number, d: number): string {
  if (d <= 0) return '–';
  return `${Math.round((n / d) * 100)}%`;
}

function rateForBar(n: number, d: number): number {
  if (d <= 0) return 0;
  return Math.max(0, Math.min(1, n / d));
}

function fmtInt(n: number): string {
  return new Intl.NumberFormat('en-US').format(n);
}

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = Date.now();
  const ageMs = now - d.getTime();
  const day = 86_400_000;
  if (ageMs < day) {
    const hrs = Math.max(1, Math.round(ageMs / 3_600_000));
    return `${hrs}h ago`;
  }
  const days = Math.round(ageMs / day);
  if (days < 30) return `${days}d ago`;
  return d.toISOString().slice(0, 10);
}

export default async function CampaignsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { userId } = await auth();
  if (!userId) redirect('/login/realtor');

  const space = await getSpaceFromSlug(slug);
  if (!space) notFound();

  // Each provider independent. One failing should not blank the page.
  const results = await Promise.allSettled([
    loadResendCampaigns(space.id, { days: 30 }),
    loadLoopsCampaigns(space.id, { days: 30 }),
  ]);

  const resendRows = results[0].status === 'fulfilled' ? results[0].value : [];
  const loopsRows = results[1].status === 'fulfilled' ? results[1].value : [];
  const bothFailed =
    results[0].status === 'rejected' && results[1].status === 'rejected';

  const merged: CampaignSummary[] = [...resendRows, ...loopsRows].sort(
    (a, b) => (a.sentAt < b.sentAt ? 1 : a.sentAt > b.sentAt ? -1 : 0),
  );
  const overview: CampaignsOverview = computeOverview(merged);
  const recent = merged.slice(0, 50);

  const header = (
    <header className="space-y-1.5">
      <h1 className={H1} style={TITLE_FONT}>
        Email campaigns
      </h1>
      <p className={BODY_MUTED}>
        What you sent and how it landed. Last 30 days.
      </p>
    </header>
  );

  // ── Empty state ────────────────────────────────────────────────────────
  if (merged.length === 0) {
    return (
      <div className={`${PAGE_RHYTHM} ${READING_MAX}`}>
        {header}
        <section className="py-16 text-center space-y-3">
          <p className={BODY_MUTED}>
            Send your first email to see results here.
          </p>
          <p>
            <Link href={`/s/${slug}/inbox`} className="underline underline-offset-4">
              Go to inbox
            </Link>
          </p>
          {bothFailed ? (
            <p className={CAPTION}>
              <span className="inline-block rounded-full border border-border/60 px-2 py-0.5">
                Could not load. Check your integrations.
              </span>
            </p>
          ) : null}
        </section>
      </div>
    );
  }

  // Largest opened-count in the table — used to scale the inline bar so the
  // strongest performer reads as 100%.
  const maxOpened = recent.reduce(
    (m, r) => (r.opened > m ? r.opened : m),
    0,
  );

  return (
    <div className={`${PAGE_RHYTHM} ${READING_MAX}`}>
      {header}

      {/* ── Overview — four big numbers ─────────────────────────────────── */}
      <section className="space-y-4">
        <p className={SECTION_LABEL}>Overview</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-8 gap-y-6">
          <div>
            <p className={STAT_NUMBER_COMPACT} style={TITLE_FONT}>
              {fmtInt(overview.totalSent30d)}
            </p>
            <p className={CAPTION}>Sent</p>
          </div>
          <div>
            <p className={STAT_NUMBER_COMPACT} style={TITLE_FONT}>
              {pct(overview.deliveredRate)}
            </p>
            <p className={CAPTION}>Delivered</p>
          </div>
          <div>
            <p className={STAT_NUMBER_COMPACT} style={TITLE_FONT}>
              {pct(overview.openRate)}
            </p>
            <p className={CAPTION}>Opened</p>
          </div>
          <div>
            <p className={STAT_NUMBER_COMPACT} style={TITLE_FONT}>
              {pct(overview.clickRate)}
            </p>
            <p className={CAPTION}>Clicked</p>
          </div>
        </div>
      </section>

      {/* ── Recent sends ─────────────────────────────────────────────────── */}
      <section className="space-y-4">
        <h2 className={H2}>Recent sends</h2>
        <div className="divide-y divide-border/60 border-y border-border/60">
          <div
            className={`${CAPTION} grid grid-cols-[1.6fr_auto_auto_auto_1fr_auto] gap-4 py-2`}
          >
            <span>Subject</span>
            <span className="text-right">Provider</span>
            <span className="text-right">Sent</span>
            <span className="text-right">Delivered</span>
            <span>Opened</span>
            <span className="text-right">When</span>
          </div>
          {recent.map((r) => {
            const openedPct = rateForBar(r.opened, r.totalSent);
            const barWidth =
              maxOpened > 0
                ? Math.max(2, Math.round((r.opened / maxOpened) * 100))
                : 0;
            return (
              <div
                key={`${r.provider}:${r.id}`}
                className="grid grid-cols-[1.6fr_auto_auto_auto_1fr_auto] items-center gap-4 py-3"
              >
                <p className={`${BODY} font-medium truncate`}>{r.subject}</p>
                <p className={`${CAPTION} whitespace-nowrap text-right`}>
                  {PROVIDER_LABEL[r.provider]}
                </p>
                <p className={`${BODY} tabular-nums whitespace-nowrap text-right`}>
                  {fmtInt(r.totalSent)}
                </p>
                <p className={`${CAPTION} tabular-nums whitespace-nowrap text-right`}>
                  {pctOf(r.delivered, r.totalSent)}
                </p>
                <div className="min-w-0 flex items-center gap-3">
                  <div
                    aria-hidden="true"
                    className="h-1 flex-1 bg-muted/40 rounded-full overflow-hidden"
                  >
                    <div
                      className="h-full bg-foreground/70"
                      style={{ width: `${barWidth}%` }}
                    />
                  </div>
                  <span className={`${CAPTION} tabular-nums whitespace-nowrap`}>
                    {r.totalSent > 0 ? pct(openedPct) : '–'}
                  </span>
                </div>
                <p className={`${CAPTION} tabular-nums whitespace-nowrap text-right`}>
                  {fmtWhen(r.sentAt)}
                </p>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
