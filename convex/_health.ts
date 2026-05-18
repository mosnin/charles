/**
 * Health ping for the /api/health/convex route.
 *
 * Deliberately auth-free and cheap: it returns the server's current
 * Date.now() so the caller can measure round-trip latency and confirm
 * the deployment is reachable. No DB reads, no identity checks.
 */
import { query } from './_generated/server';

export const ping = query({
  args: {},
  handler: async () => {
    return { ok: true as const, serverTime: Date.now() };
  },
});
