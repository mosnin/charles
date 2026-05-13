/**
 * Marketing › Campaigns — inline preview of recent sends.
 *
 * Same data source as Sales › Campaigns, framed by Marketing instead. Same
 * inline table; same out-link. We do not duplicate the analytics rollup
 * — that lives on the Analytics tab.
 */

import Link from 'next/link';
import {
  loadCampaignsOverview,
  loadRecentCampaigns,
} from '@/lib/email-campaigns/rollup';
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

function pct(n: number): string {
  if (!isFinite(n) || n <= 0) return '0%';
  return `${Math.round(n * 100)}%`;
}

function fmtInt(n: number): string {
  return n.toLocaleString('en-US');
}

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const ageMs = Date.now() - d.getTime();
  const day = 86_400_000;
  if (ageMs < day) {
    const hrs = Math.max(1, Math.round(ageMs / 3_600_000));
    return `${hrs}h ago`;
  }
  const days = Math.round(ageMs / day);
  if (days < 30) return `${days}d ago`;
  return d.toISOString().slice(0, 10);
}

export async function MarketingCampaigns({ spaceId, spaceSlug }: Props) {
  const [rows, overview] = await Promise.all([
    loadRecentCampaigns(spaceId, 30),
    loadCampaignsOverview(spaceId, 30),
  ]);
  const recent = rows.slice(0, 10);

  if (recent.length === 0) {
    return (
      <EmptyState
        title="Nothing sent yet."
        hint="Draft a campaign from chat. Charles holds it for your approval before it sends."
        cta={{ label: 'Open campaigns', href: `/s/${spaceSlug}/campaigns` }}
      />
    );
  }

  return (
    <section className="space-y-6">
      {/* Overview — four numbers */}
      <div className="rounded-2xl border border-slate-200 bg-white px-6 py-5 space-y-3">
        <p className={SECTION_LABEL}>Last 30 days</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-8 gap-y-4">
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
      </div>

      {/* Recent sends */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-2">
        <div className={`${CAPTION} grid grid-cols-[1.6fr_auto_auto] gap-4 py-2 px-2`}>
          <span>Subject</span>
          <span className="text-right">Sent</span>
          <span className="text-right">When</span>
        </div>
        <div className="divide-y divide-slate-100">
          {recent.map((r) => (
            <div
              key={`${r.provider}:${r.id}`}
              className="grid grid-cols-[1.6fr_auto_auto] items-center gap-4 px-2 py-2.5"
            >
              <p className={`${BODY} font-medium truncate`}>{r.subject}</p>
              <p className={`${BODY} tabular-nums whitespace-nowrap text-right`}>
                {fmtInt(r.totalSent)}
              </p>
              <p className={`${CAPTION} tabular-nums whitespace-nowrap text-right`}>
                {fmtWhen(r.sentAt)}
              </p>
            </div>
          ))}
        </div>
        <p className={`${BODY_MUTED} pt-2 px-2`}>
          <Link
            href={`/s/${spaceSlug}/campaigns`}
            className="underline underline-offset-4 hover:text-slate-900"
          >
            Open all campaigns
          </Link>
        </p>
      </div>
    </section>
  );
}
