/**
 * GET /api/space/[slug]/audit-feed?limit=8
 *
 * Thin wrapper around `loadAuditFeed` for client-side polling (the canvas
 * chat dock refreshes every 30s). Returns the same `AuditEvent[]` the
 * server-side render uses, so the wire shape and the prop shape are
 * identical and the client can swap in fresh data without remapping.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireSpaceOwner } from '@/lib/api-auth';
import { loadAuditFeed } from '@/lib/observability/audit-feed';

type Params = { params: Promise<{ slug: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  const { slug } = await params;

  const authResult = await requireSpaceOwner(slug);
  if (authResult instanceof NextResponse) return authResult;
  const { space } = authResult;

  const limitRaw = req.nextUrl.searchParams.get('limit');
  const parsed = limitRaw ? Number.parseInt(limitRaw, 10) : 8;
  const limit = Number.isFinite(parsed) ? Math.min(Math.max(1, parsed), 50) : 8;

  const events = await loadAuditFeed(space.id, { limit });
  return NextResponse.json(events);
}
