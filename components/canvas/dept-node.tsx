'use client';

/**
 * Department node — one of six small cards orbiting the centerpiece.
 *
 * Pixel-art dept icons resolve through `iconForDepartment` (lib/icons/
 * manifest.ts). Click target is the whole card; it routes to the
 * department detail page at `/s/{slug}/d/{deptSlug}`.
 *
 * When a live `activityKey` arrives (a new canvasActivity row id from
 * Convex), the card pulses once and settles. The key is what the parent
 * passes — same key, no re-pulse; new key, ripple again.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { cn } from '@/lib/utils';
import type { AutonomyLevel, DepartmentSlug } from '@/lib/departments/autonomy';
import { iconForDepartment } from '@/lib/icons/manifest';
import { StatusDot } from './status-dot';

interface Props {
  spaceSlug: string;
  deptSlug: DepartmentSlug;
  name: string;
  autonomyLevel: AutonomyLevel;
  runningCount?: number;
  queuedCount?: number;
  idleCount?: number;
  /** Most recent canvasActivity row id seen for this dept. Triggers a
   *  one-shot ripple when it changes. Undefined = no live layer. */
  activityKey?: string;
  className?: string;
}

const PULSE_MS = 1500;

export function DeptNode({
  spaceSlug,
  deptSlug,
  name,
  autonomyLevel,
  runningCount = 0,
  queuedCount = 0,
  idleCount = 0,
  activityKey,
  className,
}: Props) {
  const [pulsing, setPulsing] = useState(false);

  useEffect(() => {
    if (!activityKey) return;
    setPulsing(true);
    const id = window.setTimeout(() => setPulsing(false), PULSE_MS);
    return () => window.clearTimeout(id);
  }, [activityKey]);

  return (
    <Link
      href={`/s/${spaceSlug}/d/${deptSlug}`}
      data-testid={`dept-node-${deptSlug}`}
      data-autonomy={autonomyLevel}
      data-pulsing={pulsing ? 'true' : undefined}
      className={cn(
        'group flex w-[120px] flex-col gap-1 rounded-xl border border-slate-200 bg-white px-2.5 py-2',
        'hover:border-slate-400 transition-colors duration-150',
        pulsing && 'dept-pulse',
        className,
      )}
    >
      <div className="flex items-center gap-1.5">
        <Image
          src={iconForDepartment(deptSlug)}
          alt=""
          width={24}
          height={24}
          className="h-6 w-6 flex-shrink-0 text-slate-700"
          aria-hidden
        />
        <span className="truncate text-[12px] font-medium text-slate-900">{name}</span>
      </div>
      <div className="flex items-center gap-1 pl-0.5">
        {runningCount > 0 ? (
          <>
            <StatusDot tone="running" />
            <span className="font-mono text-[10px] text-slate-500 tabular-nums">{runningCount}</span>
          </>
        ) : (
          <StatusDot tone="idle" />
        )}
        {queuedCount > 0 ? (
          <>
            <StatusDot tone="queued" />
            <span className="font-mono text-[10px] text-slate-500 tabular-nums">{queuedCount}</span>
          </>
        ) : (
          <StatusDot tone="idle" />
        )}
        {idleCount > 0 && (
          <span className="ml-auto font-mono text-[10px] text-slate-400 tabular-nums">
            {idleCount}
          </span>
        )}
      </div>
    </Link>
  );
}
