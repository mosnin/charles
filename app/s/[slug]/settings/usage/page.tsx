import { notFound, redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import { getSpaceFromSlug } from '@/lib/space';
import { loadRollup, type RollupRow } from '@/lib/observability/cost-events';
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
 * Usage — one screen, one question: what is Charles costing you.
 *
 * No tabs, no toggles, no filters. Last 30 days, three lenses, in
 * decreasing zoom: total, by department, by model, by day. The dashboard
 * teaches itself; we don't narrate it.
 */

const DEPT_NAMES: Record<string, string> = {
  engineering: 'Engineering',
  sales: 'Sales',
  marketing: 'Marketing',
  design: 'Design',
  support: 'Support',
  ops_finance: 'Ops / Finance',
  manager: 'Manager',
  in_process: 'In-process',
};

function fmtUsd(n: number): string {
  if (n === 0) return '$0.00';
  if (n < 0.01) return `$${n.toFixed(4)}`;
  if (n < 1) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(2)}`;
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export default async function UsagePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { userId } = await auth();
  if (!userId) redirect('/login/realtor');

  const space = await getSpaceFromSlug(slug);
  if (!space) notFound();

  const rows: RollupRow[] = await loadRollup(space.id, 30);

  // ── Empty state ────────────────────────────────────────────────────────
  if (rows.length === 0) {
    return (
      <div className={`${PAGE_RHYTHM} ${READING_MAX}`}>
        <header className="space-y-1.5">
          <p className={BODY_MUTED}>Settings.</p>
          <h1 className={H1} style={TITLE_FONT}>
            Usage
          </h1>
          <p className={BODY_MUTED}>
            What Charles cost you, broken down by department and model. Last 30 days.
          </p>
        </header>
        <section className="py-16 text-center">
          <p className={BODY_MUTED}>
            No events yet. Charles will start logging costs after the next conversation.
          </p>
        </section>
      </div>
    );
  }

  // ── Aggregations ───────────────────────────────────────────────────────
  let totalCost = 0;
  const byDept = new Map<string, { runs: number; cost: number }>();
  const byModel = new Map<
    string,
    { input: number; output: number; cost: number }
  >();
  const byDay = new Map<string, number>();

  for (const r of rows) {
    totalCost += r.totalCostUsd;

    const d = byDept.get(r.department) ?? { runs: 0, cost: 0 };
    d.runs += 1;
    d.cost += r.totalCostUsd;
    byDept.set(r.department, d);

    const m = byModel.get(r.model) ?? { input: 0, output: 0, cost: 0 };
    m.input += r.totalInputTokens;
    m.output += r.totalOutputTokens;
    m.cost += r.totalCostUsd;
    byModel.set(r.model, m);

    byDay.set(r.day, (byDay.get(r.day) ?? 0) + r.totalCostUsd);
  }

  const totalRuns = rows.length;
  const maxDeptCost = Math.max(...[...byDept.values()].map((v) => v.cost), 0.0001);
  const maxDayCost = Math.max(...[...byDay.values()], 0.0001);

  const deptRows = [...byDept.entries()]
    .map(([dept, v]) => ({ dept, ...v }))
    .sort((a, b) => b.cost - a.cost);

  const modelRows = [...byModel.entries()]
    .map(([model, v]) => ({ model, ...v }))
    .sort((a, b) => b.cost - a.cost);

  // Build the last 30 days, oldest → newest, filling in zeros so the
  // sparkline reads as a real time series, not a sparse scatter.
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const dayList: Array<{ day: string; cost: number }> = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86_400_000);
    const key = d.toISOString().slice(0, 10);
    dayList.push({ day: key, cost: byDay.get(key) ?? 0 });
  }

  return (
    <div className={`${PAGE_RHYTHM} ${READING_MAX}`}>
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="space-y-1.5">
        <p className={BODY_MUTED}>Settings.</p>
        <h1 className={H1} style={TITLE_FONT}>
          Usage
        </h1>
        <p className={BODY_MUTED}>
          What Charles cost you, broken down by department and model. Last 30 days.
        </p>
      </header>

      {/* ── Total — the one big number ─────────────────────────────────── */}
      <section className="space-y-2">
        <p className={SECTION_LABEL}>Total</p>
        <p className={STAT_NUMBER} style={TITLE_FONT}>
          {fmtUsd(totalCost)}
        </p>
        <p className={BODY_MUTED}>
          across {totalRuns} {totalRuns === 1 ? 'run' : 'runs'}.
        </p>
      </section>

      {/* ── By department ─────────────────────────────────────────────── */}
      <section className="space-y-4">
        <h2 className={H2}>By department</h2>
        <div className="divide-y divide-border/60 border-y border-border/60">
          {deptRows.map((r) => {
            const pct = Math.max(2, Math.round((r.cost / maxDeptCost) * 100));
            return (
              <div
                key={r.dept}
                className="grid grid-cols-[1fr_auto_auto] items-center gap-4 py-3"
              >
                <div className="min-w-0">
                  <p className={`${BODY} font-medium truncate`}>
                    {DEPT_NAMES[r.dept] ?? r.dept}
                  </p>
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
                <p className={`${CAPTION} tabular-nums whitespace-nowrap`}>
                  {r.runs} {r.runs === 1 ? 'run' : 'runs'}
                </p>
                <p className={`${BODY} tabular-nums whitespace-nowrap`}>
                  {fmtUsd(r.cost)}
                </p>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── By model ───────────────────────────────────────────────────── */}
      <section className="space-y-4">
        <h2 className={H2}>By model</h2>
        <div className="divide-y divide-border/60 border-y border-border/60">
          <div
            className={`${CAPTION} grid grid-cols-[1fr_auto_auto_auto] gap-4 py-2`}
          >
            <span>Model</span>
            <span className="text-right">Input</span>
            <span className="text-right">Output</span>
            <span className="text-right">Cost</span>
          </div>
          {modelRows.map((r) => (
            <div
              key={r.model}
              className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-4 py-3"
            >
              <p className={`${BODY} font-medium truncate`}>{r.model}</p>
              <p className={`${CAPTION} tabular-nums whitespace-nowrap text-right`}>
                {fmtTokens(r.input)}
              </p>
              <p className={`${CAPTION} tabular-nums whitespace-nowrap text-right`}>
                {fmtTokens(r.output)}
              </p>
              <p className={`${BODY} tabular-nums whitespace-nowrap text-right`}>
                {fmtUsd(r.cost)}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* ── By day ─────────────────────────────────────────────────────── */}
      <section className="space-y-4">
        <h2 className={H2}>By day</h2>

        {/* Sparkline — HTML divs only, one bar per day, 30 days */}
        <div
          aria-hidden="true"
          className="flex items-end gap-[2px] h-16 border-b border-border/60"
        >
          {dayList.map((d) => {
            const h = Math.max(1, Math.round((d.cost / maxDayCost) * 100));
            return (
              <div
                key={d.day}
                title={`${d.day} — ${fmtUsd(d.cost)}`}
                className="flex-1 bg-foreground/60"
                style={{ height: `${h}%` }}
              />
            );
          })}
        </div>

        <div className="divide-y divide-border/60 border-y border-border/60">
          {[...dayList].reverse().map((d) => (
            <div
              key={d.day}
              className="grid grid-cols-[1fr_auto] items-center gap-4 py-2.5"
            >
              <p className={`${BODY} tabular-nums`}>{d.day}</p>
              <p className={`${BODY} tabular-nums whitespace-nowrap`}>
                {fmtUsd(d.cost)}
              </p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
