'use client';

/**
 * Subscribes to Convex `realtimeTicks` of kind=approval for the current
 * space; when a new tick lands, the server component re-renders. Renders
 * nothing. Pure side-effect island so the rest of the approvals page
 * stays server-side.
 */

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useOnRealtimeTick } from '@/lib/convex/use-realtime-ticks';

export function RealtimeApprovalsRefresher({ spaceId }: { spaceId: string }) {
  const router = useRouter();
  const refresh = useCallback(() => {
    router.refresh();
  }, [router]);

  useOnRealtimeTick(spaceId, 'approval', refresh);

  return null;
}
