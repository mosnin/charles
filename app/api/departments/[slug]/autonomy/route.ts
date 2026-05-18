/**
 * PATCH /api/departments/[slug]/autonomy
 *
 * Persist a per-department autonomy change for the calling founder's space.
 * Tight surface: auth → space ownership → validate slug → validate level →
 * upsert → return the new row. No partial updates, no batch — one row, one
 * call, one outcome.
 *
 * Why PATCH: the resource is a department, and we're modifying one of its
 * fields. PUT would imply the founder is sending the full row; they're not.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { getSpaceForUser } from '@/lib/space';
import {
  isAutonomyLevel,
  isDepartmentSlug,
  setDepartmentAutonomy,
} from '@/lib/departments/autonomy';
import { logger } from '@/lib/logger';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  const { slug } = await params;
  if (!isDepartmentSlug(slug)) {
    return NextResponse.json({ error: 'Unknown department' }, { status: 404 });
  }

  // Parse + validate the body. Reject anything that isn't a known level.
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const level = (body as { autonomyLevel?: unknown } | null)?.autonomyLevel;
  if (!isAutonomyLevel(level)) {
    return NextResponse.json(
      { error: 'autonomyLevel must be one of observe, ask, auto-low, autonomous' },
      { status: 400 },
    );
  }

  // Space ownership — only the founder who owns the space can change its
  // department autonomy. Brokerage admin pass-through is intentionally out
  // of scope here; Charles is a per-founder cofounder.
  const space = await getSpaceForUser(userId);
  if (!space) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    await setDepartmentAutonomy(space.id, slug, level);
    return NextResponse.json({
      slug,
      autonomyLevel: level,
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    // Never leak DB internals to the founder. Log loud, return short.
    logger.error('[departments.autonomy] persist failed', {
      userId,
      spaceId: space.id,
      slug,
      level,
      err: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { error: 'Could not save the change. Try again.' },
      { status: 500 },
    );
  }
}
