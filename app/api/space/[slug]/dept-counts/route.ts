/**
 * GET /api/space/[slug]/dept-counts
 *
 * Thin wrapper around `loadDeptCounts` for the client-side canvas to
 * refresh running/queued counts on Realtime ticks (and the 30s polling
 * fallback). Returns the same Record<DepartmentSlug, DeptCounts> the
 * server-side render uses, so the prop shape matches the wire shape.
 */

import { NextResponse } from 'next/server';
import { requireSpaceOwner } from '@/lib/api-auth';
import { loadDeptCounts } from '@/lib/canvas/dept-counts';

type Params = { params: Promise<{ slug: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { slug } = await params;
  const authResult = await requireSpaceOwner(slug);
  if (authResult instanceof NextResponse) return authResult;
  const { space } = authResult;

  const counts = await loadDeptCounts(space.id);
  return NextResponse.json(counts);
}
