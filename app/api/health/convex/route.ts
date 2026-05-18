/**
 * GET /api/health/convex — is the Convex live-state layer reachable?
 *
 * Any logged-in user can hit this. We run the cheapest possible query
 * (`_health.ping`), measure round-trip latency, and return a small
 * JSON status. The handler never throws — every failure mode maps to
 * a JSON body so the client badge can render confidently.
 */
import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '@/convex/_generated/api';

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) {
    return NextResponse.json(
      {
        status: 'unconfigured',
        message: 'NEXT_PUBLIC_CONVEX_URL is not set',
      },
      { status: 200 },
    );
  }

  const startedAt = Date.now();
  try {
    const client = new ConvexHttpClient(url);
    const result = (await client.query(api._health.ping, {})) as {
      ok: boolean;
      serverTime: number;
    };
    const latencyMs = Date.now() - startedAt;
    if (!result?.ok) {
      return NextResponse.json(
        { status: 'unhealthy', error: 'Unexpected ping response', latencyMs },
        { status: 503 },
      );
    }
    return NextResponse.json(
      {
        status: 'healthy',
        latencyMs,
        serverTime: result.serverTime,
      },
      { status: 200 },
    );
  } catch (e: unknown) {
    const latencyMs = Date.now() - startedAt;
    const error = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json(
      { status: 'unhealthy', error, latencyMs },
      { status: 503 },
    );
  }
}
