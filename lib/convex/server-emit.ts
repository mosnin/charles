/**
 * Server-side bridge into the Convex `canvasActivity.emit` mutation.
 *
 * Best-effort. Never throws. No-ops when NEXT_PUBLIC_CONVEX_URL is unset
 * or when the emit fails — the live ripple is a layer on top of the
 * Supabase polling fallback, not a hard requirement. Auth is attached
 * only when CONVEX_SERVICE_JWT is present (the `emit` mutation requires
 * an authenticated identity; without a token we skip cleanly).
 */

import { ConvexHttpClient } from 'convex/browser';
import { api } from '../../convex/_generated/api';
import { logger } from '@/lib/logger';

export type CanvasActivityDepartment =
  | 'engineering'
  | 'sales'
  | 'marketing'
  | 'design'
  | 'support'
  | 'ops_finance';

export type CanvasActivityKind = 'running' | 'queued' | 'done' | 'failed';

export interface EmitArgs {
  spaceId: string;
  department: CanvasActivityDepartment;
  kind: CanvasActivityKind;
  summary: string;
}

function convexUrl(): string | undefined {
  return process.env.NEXT_PUBLIC_CONVEX_URL || undefined;
}

function serviceJwt(): string | undefined {
  return process.env.CONVEX_SERVICE_JWT || undefined;
}

/**
 * Emit a canvasActivity ping. Returns true if the call was attempted and
 * the mutation accepted it; false on no-op or any failure. Never rejects.
 */
export async function emitCanvasActivity(args: EmitArgs): Promise<boolean> {
  const url = convexUrl();
  if (!url) return false;

  try {
    const client = new ConvexHttpClient(url);
    const jwt = serviceJwt();
    if (jwt) client.setAuth(jwt);

    // The api ref is typed `anyApi` in the codegen stub; we know the
    // shape and cast both function ref and arg payload through unknown
    // so the call type-checks without a real generated `api` here.
    const fn = (api as unknown as {
      canvasActivity: { emit: unknown };
    }).canvasActivity.emit;

    const mutate = client.mutation as unknown as (
      f: unknown,
      a: unknown,
    ) => Promise<unknown>;
    await mutate(fn, {
      spaceId: args.spaceId,
      department: args.department,
      kind: args.kind,
      summary: args.summary,
    });
    return true;
  } catch (err) {
    logger.warn('[canvas-activity] emit failed', { err: String(err) });
    return false;
  }
}
