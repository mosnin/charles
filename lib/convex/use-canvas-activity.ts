'use client';

/**
 * useCanvasActivity — reactive view of the Convex `canvasActivity.forSpace`
 * query, scoped to one space. Returns the active (non-expired) rows in
 * descending recency order. Filters expired rows client-side so a slow
 * GC pass on the Convex side doesn't surface stale state.
 *
 * Empty array when Convex is unavailable (no provider mounted, no URL,
 * query errored). The canvas degrades to the server-loaded counts.
 */

import { useMemo } from 'react';
import { useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';

export interface CanvasActivity {
  id: string;
  department: string;
  kind: 'running' | 'queued' | 'done' | 'failed';
  summary: string;
  createdAt: number;
  expiresAt: number;
}

interface ConvexActivityRow {
  _id: string;
  spaceId: string;
  department: string;
  kind: 'running' | 'queued' | 'done' | 'failed';
  summary: string;
  createdAt: number;
  expiresAt: number;
}

export function useCanvasActivity(spaceId: string): CanvasActivity[] {
  const fn = (api as unknown as {
    canvasActivity: { forSpace: unknown };
  }).canvasActivity.forSpace;

  // useQuery returns `undefined` while loading and on error. We treat both
  // the same way: empty list, no ripple. The typed `api` codegen stub is
  // `anyApi`, so we route through unknown to keep the call site readable.
  const q = useQuery as unknown as (f: unknown, a: unknown) => unknown;
  const rows = q(fn, { spaceId }) as ConvexActivityRow[] | undefined;

  return useMemo(() => {
    if (!rows || !Array.isArray(rows)) return [];
    const now = Date.now();
    return rows
      .filter((r) => r && r.expiresAt > now)
      .map((r) => ({
        id: r._id,
        department: r.department,
        kind: r.kind,
        summary: r.summary,
        createdAt: r.createdAt,
        expiresAt: r.expiresAt,
      }));
  }, [rows]);
}
