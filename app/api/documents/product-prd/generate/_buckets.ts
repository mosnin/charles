/**
 * Rate-cap bucket store for /api/documents/product-prd/generate.
 *
 * Same shape as app/api/brand/generate-logo/_buckets.ts — a process-local map
 * counting timestamps per space. 5 generations per hour is a hard cap. The
 * counter is ephemeral on purpose; if the process restarts the founder gets
 * a fresh budget, which is fine for an autogeneration that costs cents.
 */

const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_HOUR = 5;

const buckets = new Map<string, number[]>();

export function checkAndRecord(
  spaceId: string,
  now: number,
): { ok: true; remaining: number } | { ok: false; remainingMs: number } {
  const stamps = buckets.get(spaceId) ?? [];
  const fresh = stamps.filter((t) => now - t < WINDOW_MS);
  if (fresh.length >= MAX_PER_HOUR) {
    const oldest = fresh[0]!;
    return { ok: false, remainingMs: WINDOW_MS - (now - oldest) };
  }
  fresh.push(now);
  buckets.set(spaceId, fresh);
  return { ok: true, remaining: MAX_PER_HOUR - fresh.length };
}

export { MAX_PER_HOUR };

/** Test-only reset. Not used by any client code path. */
export function __resetBuckets(): void {
  buckets.clear();
}
