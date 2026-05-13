/**
 * Sales › Campaigns — recent sends rollup, scoped to this tab.
 *
 * Reuses `loadRecentCampaigns` and renders a compact table inline. We
 * deliberately do NOT rebuild the full /campaigns page here — this is a
 * 10-row preview with a link out.
 */

import Link from 'next/link';
import { loadRecentCampaigns } from '@/lib/email-campaigns/rollup';
import { BODY, CAPTION } from '@/lib/typography';
import { EmptyState } from './empty-state';

interface Props {
  spaceId: string;
  spaceSlug: string;
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

export async function SalesCampaigns({ spaceId, spaceSlug }: Props) {
  const rows = await loadRecentCampaigns(spaceId, 30);
  const recent = rows.slice(0, 10);

  if (recent.length === 0) {
    return (
      <EmptyState
        title="No campaigns yet."
        hint="Send your first campaign from chat. Charles drafts, you approve, it goes out."
        cta={{ label: 'Open campaigns', href: `/s/${spaceSlug}/campaigns` }}
      />
    );
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 space-y-2">
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
              {r.totalSent.toLocaleString('en-US')}
            </p>
            <p className={`${CAPTION} tabular-nums whitespace-nowrap text-right`}>
              {fmtWhen(r.sentAt)}
            </p>
          </div>
        ))}
      </div>
      <div className="pt-2 px-2">
        <Link
          href={`/s/${spaceSlug}/campaigns`}
          className="text-[13px] underline underline-offset-4 text-slate-700 hover:text-slate-900"
        >
          Open all campaigns
        </Link>
      </div>
    </section>
  );
}
