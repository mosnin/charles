/**
 * In-memory rate limit for workspace-template applies.
 *
 * 4 applies per space per 24h, tracked in-process. Restart clears the
 * bucket — fine. The alternative (DB table) doesn't earn its keep for a
 * guardrail nobody hits unless they're scripting.
 *
 * Lives outside the route file because Next route modules disallow
 * arbitrary named exports.
 */

export const APPLY_LIMIT_PER_DAY = 4;
const dayMs = 24 * 60 * 60 * 1000;

const applyBucket = new Map<string, number[]>(); // spaceId → timestamps

export function checkAndRecordApply(spaceId: string, now: number): boolean {
  const cutoff = now - dayMs;
  const hits = (applyBucket.get(spaceId) ?? []).filter((t) => t >= cutoff);
  if (hits.length >= APPLY_LIMIT_PER_DAY) {
    applyBucket.set(spaceId, hits);
    return false;
  }
  hits.push(now);
  applyBucket.set(spaceId, hits);
  return true;
}

/** Test-only hook. Clears every space's apply history. */
export function __resetApplyBucketForTests(): void {
  applyBucket.clear();
}
