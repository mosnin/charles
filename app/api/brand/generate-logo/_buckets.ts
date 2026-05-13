/**
 * Rate-cap bucket store for /api/brand/generate-logo.
 *
 * Lives in its own module because Next.js route files may only export a
 * narrow set of HTTP method handlers (GET/POST/etc.) — exporting arbitrary
 * symbols from a route.ts trips the Next.js route-type validator. Tests need
 * a way to reset the in-process counter; the route needs to read/write it.
 * Both import from here.
 */

const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_HOUR = 3;

const buckets = new Map<string, number[]>();

export function checkAndRecord(
  spaceId: string,
  now: number,
): { ok: true } | { ok: false; remainingMs: number } {
  const stamps = buckets.get(spaceId) ?? [];
  const fresh = stamps.filter((t) => now - t < WINDOW_MS);
  if (fresh.length >= MAX_PER_HOUR) {
    const oldest = fresh[0]!;
    return { ok: false, remainingMs: WINDOW_MS - (now - oldest) };
  }
  fresh.push(now);
  buckets.set(spaceId, fresh);
  return { ok: true };
}

/** Test-only reset. Not used by any client code path. */
export function __resetBuckets(): void {
  buckets.clear();
}
