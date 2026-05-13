/**
 * Marketing › Analytics — PostHog snapshot.
 *
 * Signups (30d) + active users + top events. Mirror of the top section
 * of /analytics. We deliberately do NOT pull the daily trend bars here
 * — those live on the full page. This tab is a glance.
 */

import Link from 'next/link';
import {
  posthogActiveUsers,
  posthogEventCount,
  posthogTopEvents,
  type EventCount,
} from '@/lib/integrations/adapters/posthog';
import { supabase } from '@/lib/supabase';
import {
  BODY,
  BODY_MUTED,
  CAPTION,
  SECTION_LABEL,
  STAT_NUMBER_COMPACT,
  TITLE_FONT,
} from '@/lib/typography';
import { EmptyState } from './empty-state';

interface Props {
  spaceId: string;
  spaceSlug: string;
}

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

export async function MarketingAnalytics({ spaceId, spaceSlug }: Props) {
  const connected = await isPostHogConnected(spaceId);
  if (!connected) {
    return (
      <EmptyState
        title="Connect PostHog to see signups and active users."
        cta={{ label: 'Open integrations', href: `/s/${spaceSlug}/integrations` }}
      />
    );
  }

  const [signupsRes, activeRes, topRes] = await Promise.allSettled([
    posthogEventCount(spaceId, SIGNUP_EVENT, 30),
    posthogActiveUsers(spaceId, 30),
    posthogTopEvents(spaceId, { days: 30, limit: 5 }),
  ]);

  const signups = signupsRes.status === 'fulfilled' ? signupsRes.value : null;
  const active = activeRes.status === 'fulfilled' ? activeRes.value : null;
  const top: EventCount[] | null =
    topRes.status === 'fulfilled' ? topRes.value : null;
  const maxEvent = top ? Math.max(1, ...top.map((e) => e.count)) : 1;

  return (
    <section className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white px-6 py-5 space-y-3">
        <p className={SECTION_LABEL}>Last 30 days</p>
        <div className="grid grid-cols-2 gap-x-8 gap-y-4">
          <div>
            <p className={STAT_NUMBER_COMPACT} style={TITLE_FONT}>
              {signups === null ? '—' : fmtInt(signups)}
            </p>
            <p className={CAPTION}>Signups</p>
          </div>
          <div>
            <p className={STAT_NUMBER_COMPACT} style={TITLE_FONT}>
              {active === null ? '—' : fmtInt(active)}
            </p>
            <p className={CAPTION}>Active users</p>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-2">
        <p className={`${SECTION_LABEL} px-2`}>Top events</p>
        {top === null ? (
          <p className={`${BODY_MUTED} px-2 py-3`}>Could not load.</p>
        ) : top.length === 0 ? (
          <p className={`${BODY_MUTED} px-2 py-3`}>No events in the last 30 days.</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {top.map((e) => {
              const pct = Math.max(2, Math.round((e.count / maxEvent) * 100));
              return (
                <div
                  key={e.event}
                  className="grid grid-cols-[1fr_auto] items-center gap-4 px-2 py-2.5"
                >
                  <div className="min-w-0">
                    <p className={`${BODY} font-medium truncate`}>{e.event}</p>
                    <div
                      aria-hidden
                      className="mt-2 h-1 w-full bg-slate-100 rounded-full overflow-hidden"
                    >
                      <div
                        className="h-full bg-slate-600"
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
        <p className={`${BODY_MUTED} pt-2 px-2`}>
          <Link
            href={`/s/${spaceSlug}/analytics`}
            className="underline underline-offset-4 hover:text-slate-900"
          >
            Open full analytics
          </Link>
        </p>
      </div>
    </section>
  );
}
