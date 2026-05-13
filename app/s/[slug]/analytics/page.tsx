import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import { getSpaceFromSlug } from '@/lib/space';
import {
  posthogActiveUsers,
  posthogEventCount,
  posthogSignupsTrend,
  posthogTopEvents,
  type EventCount,
  type TrendPoint,
} from '@/lib/integrations/adapters/posthog';
import { supabase } from '@/lib/supabase';
import {
  H1,
  H2,
  TITLE_FONT,
  BODY,
  BODY_MUTED,
  CAPTION,
  SECTION_LABEL,
  STAT_NUMBER,
  PAGE_RHYTHM,
  READING_MAX,
} from '@/lib/typography';

/**
 * Product analytics — one screen, three questions.
 *
 *   - Total signups (30d) + change vs the prior 30d.
 *   - Active users (30d).
 *   - Daily signups (HTML sparkline + table).
 *   - Top events.
 *
 * Each section runs independently via Promise.allSettled so a single 4xx
 * doesn't blank the page. No chart libs — every visual is a div.
 */

const SIGNUP_EVENT = 'user signed up';

async function isPostHogConnected(spaceId: string): Promise<boolean> {
  if (process.env.POSTHOG_API_KEY && process.env.POSTHOG_PROJECT_ID) return true;
  try {
    const { data } = await supabase
      .from('IntegrationConnection')
      .select('accessToken, accessKey, status')
      .eq('spaceId', spaceId)
      .eq('toolkit', 'posthog')
      .eq('status', 'active')
      .maybeSingle();
    const row = data as { accessToken?: string; accessKey?: string } | null;
    return Boolean(row?.accessToken && row?.accessKey);
  } catch {
    return false;
  }
}

function fmtInt(n: number): string {
  return n.toLocaleString('en-US');
}

function fmtPct(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const sign = n > 0 ? '+' : '';
  return `${sign}${(n * 100).toFixed(0)}%`;
}

function lastNDays(n: number, end: Date): Array<{ day: string; count: number }> {
  const days: Array<{ day: string; count: number }> = [];
  const e = new Date(end);
  e.setUTCHours(0, 0, 0, 0);
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(e.getTime() - i * 86_400_000);
    days.push({ day: d.toISOString().slice(0, 10), count: 0 });
  }
  return days;
}

function mergeTrend(
  scaffold: Array<{ day: string; count: number }>,
  rows: TrendPoint[],
): Array<{ day: string; count: number }> {
  const map = new Map(rows.map((r) => [r.day, r.count]));
  return scaffold.map((d) => ({ day: d.day, count: map.get(d.day) ?? 0 }));
}

export default async function AnalyticsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { userId } = await auth();
  if (!userId) redirect('/login/realtor');

  const space = await getSpaceFromSlug(slug);
  if (!space) notFound();

  const connected = await isPostHogConnected(space.id);

  if (!connected) {
    return (
      <div className={`${PAGE_RHYTHM} ${READING_MAX}`}>
        <header className="space-y-1.5">
          <h1 className={H1} style={TITLE_FONT}>
            Product analytics
          </h1>
          <p className={BODY_MUTED}>
            What real people are doing. Last 30 days.
          </p>
        </header>
        <section className="rounded-xl border border-border/70 bg-background px-6 py-12 space-y-4">
          <p className={BODY}>
            Connect PostHog in Integrations to see signups, active users, and funnels.
          </p>
          <Link
            href={`/s/${slug}/integrations`}
            className={`${BODY} underline underline-offset-2`}
          >
            Open integrations
          </Link>
        </section>
      </div>
    );
  }

  // Run every query in parallel; isolate failures.
  const [
    signups30,
    signupsPrior30,
    activeUsers30,
    trend60,
    topEventsResult,
  ] = await Promise.allSettled([
    posthogEventCount(space.id, SIGNUP_EVENT, 30),
    posthogEventCount(space.id, SIGNUP_EVENT, 60),
    posthogActiveUsers(space.id, 30),
    posthogSignupsTrend(space.id, 30),
    posthogTopEvents(space.id, { days: 30, limit: 10 }),
  ]);

  const signupsNow = signups30.status === 'fulfilled' ? signups30.value : null;
  const signupsTotal60 =
    signupsPrior30.status === 'fulfilled' ? signupsPrior30.value : null;
  const signupsPrior =
    signupsNow !== null && signupsTotal60 !== null
      ? Math.max(0, signupsTotal60 - signupsNow)
      : null;
  const signupsChange =
    signupsNow !== null && signupsPrior !== null && signupsPrior > 0
      ? (signupsNow - signupsPrior) / signupsPrior
      : null;

  const activeUsers =
    activeUsers30.status === 'fulfilled' ? activeUsers30.value : null;

  const trendDays = lastNDays(30, new Date());
  const trend =
    trend60.status === 'fulfilled' ? mergeTrend(trendDays, trend60.value) : null;
  const maxDay = trend
    ? Math.max(1, ...trend.map((d) => d.count))
    : 1;

  const topEvents: EventCount[] | null =
    topEventsResult.status === 'fulfilled' ? topEventsResult.value : null;
  const maxEvent = topEvents
    ? Math.max(1, ...topEvents.map((e) => e.count))
    : 1;

  return (
    <div className={`${PAGE_RHYTHM} ${READING_MAX}`}>
      <header className="space-y-1.5">
        <h1 className={H1} style={TITLE_FONT}>
          Product analytics
        </h1>
        <p className={BODY_MUTED}>
          What real people are doing. Last 30 days.
        </p>
      </header>

      {/* ── Total signups ─────────────────────────────────────────────── */}
      <section className="space-y-2">
        <p className={SECTION_LABEL}>Total signups (30d)</p>
        {signupsNow === null ? (
          <p className={BODY_MUTED}>Could not load.</p>
        ) : (
          <>
            <p className={STAT_NUMBER} style={TITLE_FONT}>
              {fmtInt(signupsNow)}
            </p>
            <p className={BODY_MUTED}>
              {signupsChange === null
                ? 'No prior window to compare.'
                : `${fmtPct(signupsChange)} vs prior 30 days.`}
            </p>
          </>
        )}
      </section>

      {/* ── Active users ─────────────────────────────────────────────── */}
      <section className="space-y-2">
        <p className={SECTION_LABEL}>Active users (30d)</p>
        {activeUsers === null ? (
          <p className={BODY_MUTED}>Could not load.</p>
        ) : (
          <p className={STAT_NUMBER} style={TITLE_FONT}>
            {fmtInt(activeUsers)}
          </p>
        )}
      </section>

      {/* ── Daily signups ─────────────────────────────────────────────── */}
      <section className="space-y-4">
        <h2 className={H2}>Daily signups</h2>
        {trend === null ? (
          <p className={BODY_MUTED}>Could not load.</p>
        ) : (
          <>
            <div
              aria-hidden="true"
              className="flex items-end gap-[2px] h-16 border-b border-border/60"
            >
              {trend.map((d) => {
                const h = Math.max(1, Math.round((d.count / maxDay) * 100));
                return (
                  <div
                    key={d.day}
                    title={`${d.day} — ${fmtInt(d.count)}`}
                    className="flex-1 bg-foreground/60"
                    style={{ height: `${h}%` }}
                  />
                );
              })}
            </div>
            <div className="divide-y divide-border/60 border-y border-border/60">
              {[...trend].reverse().map((d) => (
                <div
                  key={d.day}
                  className="grid grid-cols-[1fr_auto] items-center gap-4 py-2.5"
                >
                  <p className={`${BODY} tabular-nums`}>{d.day}</p>
                  <p className={`${BODY} tabular-nums whitespace-nowrap`}>
                    {fmtInt(d.count)}
                  </p>
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      {/* ── Top events ───────────────────────────────────────────────── */}
      <section className="space-y-4">
        <h2 className={H2}>Top events</h2>
        {topEvents === null ? (
          <p className={BODY_MUTED}>Could not load.</p>
        ) : topEvents.length === 0 ? (
          <p className={BODY_MUTED}>No events in the last 30 days.</p>
        ) : (
          <div className="divide-y divide-border/60 border-y border-border/60">
            <div
              className={`${CAPTION} grid grid-cols-[1fr_auto] gap-4 py-2`}
            >
              <span>Event</span>
              <span className="text-right">Count</span>
            </div>
            {topEvents.map((e) => {
              const pct = Math.max(2, Math.round((e.count / maxEvent) * 100));
              return (
                <div
                  key={e.event}
                  className="grid grid-cols-[1fr_auto] items-center gap-4 py-3"
                >
                  <div className="min-w-0">
                    <p className={`${BODY} font-medium truncate`}>{e.event}</p>
                    <div
                      aria-hidden="true"
                      className="mt-2 h-1 w-full bg-muted/40 rounded-full overflow-hidden"
                    >
                      <div
                        className="h-full bg-foreground/70"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                  <p className={`${BODY} tabular-nums whitespace-nowrap`}>
                    {fmtInt(e.count)}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
