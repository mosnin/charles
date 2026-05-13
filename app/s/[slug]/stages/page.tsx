/**
 * /s/[slug]/stages — the kanban canvas of where the company stands.
 *
 * Loads the Mission (for current stage) and every StageGate row for this
 * workspace, groups them by stage, and hands the columns to the canvas.
 * Stages with no DB rows yet fall back to catalog placeholders — those
 * are read-only "not yet started" cards. Lazy seeding remains the
 * manager's job; this page never writes.
 */

import { redirect, notFound } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import { getSpaceFromSlug } from '@/lib/space';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { BODY_MUTED, TITLE_FONT } from '@/lib/typography';
import { STAGE_ORDER, type Stage } from '@/lib/stages/catalog';
import {
  groupGatesByStage,
  placeholderGatesFor,
  type CanvasGate,
} from '@/lib/stages/canvas-helpers';
import { StagesCanvas } from '@/components/canvas/stages-canvas';
import { PresenceHeartbeat } from '@/components/canvas/presence-heartbeat';

interface MissionRow {
  stage: Stage;
}

interface StageGateRow {
  id: string;
  stage: Stage;
  title: string;
  isComplete: boolean;
  order: number | null;
}

export default async function StagesPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { userId } = await auth();
  if (!userId) redirect('/sign-in');

  const space = await getSpaceFromSlug(slug);
  if (!space) notFound();

  const [missionResult, gatesResult] = await Promise.allSettled([
    supabase
      .from('Mission')
      .select('stage')
      .eq('spaceId', space.id)
      .maybeSingle(),
    supabase
      .from('StageGate')
      .select('id, stage, title, isComplete, order')
      .eq('spaceId', space.id),
  ]);

  const mission =
    missionResult.status === 'fulfilled' && missionResult.value.data
      ? (missionResult.value.data as MissionRow)
      : null;
  const currentStage: Stage = mission?.stage ?? 'idea';

  const dbGates: CanvasGate[] =
    gatesResult.status === 'fulfilled' && gatesResult.value.data
      ? (gatesResult.value.data as StageGateRow[]).map((r) => ({
          id: r.id,
          stage: r.stage,
          title: r.title,
          isComplete: r.isComplete,
          order: r.order,
          metadata: null,
        }))
      : [];

  // Group what's in the DB; fall back to catalog placeholders per empty column.
  const grouped = groupGatesByStage(dbGates);
  const placeholderStages = new Set<Stage>();
  const columns = {} as Record<Stage, CanvasGate[]>;
  for (const stage of STAGE_ORDER) {
    if (grouped[stage].length > 0) {
      columns[stage] = grouped[stage];
    } else {
      columns[stage] = placeholderGatesFor(stage);
      placeholderStages.add(stage);
    }
  }

  return (
    <div className="mx-auto w-full max-w-[1500px] px-4 pt-6 pb-20 space-y-6 md:px-6 md:pt-10 md:pb-24 md:space-y-8">
      <header className="space-y-2">
        <p className={cn(BODY_MUTED, 'font-mono text-[11px] uppercase tracking-wide')}>
          Stages
        </p>
        <h1 className="text-3xl tracking-tight text-foreground" style={TITLE_FONT}>
          Where the company stands.
        </h1>
        <p className={cn(BODY_MUTED, 'max-w-[60ch] text-base')}>
          Six stages, one column each. Check what you have shipped. Charles handles the rest.
        </p>
      </header>

      <StagesCanvas
        slug={slug}
        currentStage={currentStage}
        columns={columns}
        placeholderStages={placeholderStages}
      />
      <PresenceHeartbeat spaceId={space.id} />
    </div>
  );
}
