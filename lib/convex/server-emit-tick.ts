/**
 * Server-side bridge into the Convex `realtimeTicks.emit` mutation.
 *
 * Best-effort. Never throws. No-ops when NEXT_PUBLIC_CONVEX_URL is unset
 * or when the emit fails — the live signal is a layer on top of the
 * Supabase polling / focus-refresh fallback, not a hard requirement.
 * Auth is attached only when CONVEX_SERVICE_JWT is present (the `emit`
 * mutation requires an authenticated identity; without a token we skip
 * cleanly).
 */

import { ConvexHttpClient } from 'convex/browser';
import { api } from '../../convex/_generated/api';
import { logger } from '@/lib/logger';

export type RealtimeTickKind = 'approval' | 'audit';

export interface EmitTickArgs {
  spaceId: string;
  kind: RealtimeTickKind;
  /** Free-form one-liner for debugging — never user-visible. */
  summary?: string;
}

function convexUrl(): string | undefined {
  return process.env.NEXT_PUBLIC_CONVEX_URL || undefined;
}

function serviceJwt(): string | undefined {
  return process.env.CONVEX_SERVICE_JWT || undefined;
}

/**
 * Emit a realtime tick. Returns true if the call was attempted and the
 * mutation accepted it; false on no-op or any failure. Never rejects.
 */
export async function emitRealtimeTick(args: EmitTickArgs): Promise<boolean> {
  const url = convexUrl();
  if (!url) return false;

  try {
    const client = new ConvexHttpClient(url);
    const jwt = serviceJwt();
    if (jwt) client.setAuth(jwt);

    // The api ref is typed `anyApi` in the codegen stub; we know the
    // shape and route through unknown so the call site type-checks
    // without a real generated `api` here. Same pattern as server-emit.ts.
    const fn = (api as unknown as {
      realtimeTicks: { emit: unknown };
    }).realtimeTicks.emit;

    const mutate = client.mutation as unknown as (
      f: unknown,
      a: unknown,
    ) => Promise<unknown>;
    await mutate(fn, {
      spaceId: args.spaceId,
      kind: args.kind,
      ...(args.summary ? { summary: args.summary } : {}),
    });
    return true;
  } catch (err) {
    logger.warn('[realtime-tick] emit failed', { err: String(err) });
    return false;
  }
}
