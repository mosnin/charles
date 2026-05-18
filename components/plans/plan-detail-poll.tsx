'use client';

/**
 * PlanDetailPoll — wraps PlanDetail with a 5s poller.
 *
 * Holds the latest PlanRun in state, seeded by the server-rendered fixture,
 * and refetches `/api/agent/plan/${runId}` every 5 seconds until the run
 * reaches a terminal status (completed / failed / cancelled). At that point
 * the interval clears and the surface stops polling.
 *
 * The endpoint doesn't exist yet — try/catch swallows network errors so
 * the surface keeps rendering the seed data while the backend lands.
 * Once the route ships, no change is required here.
 */

import { useEffect, useRef, useState } from 'react';
import { PlanDetail } from './plan-detail';
import type { PlanRun, PlanRunStatus } from '@/lib/plans/types';

interface Props {
  initialRun: PlanRun;
  slug: string;
}

const POLL_INTERVAL_MS = 5000;

function isTerminal(status: PlanRunStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

export function PlanDetailPoll({ initialRun, slug: _slug }: Props) {
  const [run, setRun] = useState<PlanRun>(initialRun);
  const runIdRef = useRef(initialRun.id);

  useEffect(() => {
    // If we landed on a terminal run, don't even start the timer.
    if (isTerminal(run.status)) return;

    let cancelled = false;

    async function refetch() {
      try {
        const res = await fetch(`/api/agent/plan/${runIdRef.current}`, {
          cache: 'no-store',
        });
        if (!res.ok) return;
        const json = (await res.json()) as { run?: PlanRun };
        if (cancelled || !json.run) return;
        setRun(json.run);
      } catch {
        // Endpoint isn't live yet, or the network blipped — keep rendering
        // what we have. The next tick will try again.
      }
    }

    const id = window.setInterval(() => {
      void refetch();
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
    // We deliberately depend on run.status so the effect tears down its
    // interval as soon as the run reaches a terminal state.
  }, [run.status]);

  return <PlanDetail run={run} />;
}
