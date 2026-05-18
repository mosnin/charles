/**
 * POST /api/brand/save — final step of the brand wizard.
 *
 * Takes the validated wizard state, formats it into the canonical brand-kit
 * markdown via the pure builder, and UPSERTs it into the Document table on
 * (spaceId, slug='brand-kit'). Same shape the existing PATCH route writes —
 * we just call the builder ourselves rather than round-tripping through HTTP.
 *
 * Returns the slug + redirect target so the client can push the founder to
 * the doc page in edit mode immediately after save.
 *
 * 200: { ok: true, redirectTo, updatedAt }
 * 400: bad body
 * 401: unauthenticated
 * 403: caller has no workspace
 * 500: DB failure
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { requireAuth } from '@/lib/api-auth';
import { getSpaceForUser } from '@/lib/space';
import { getDocument } from '@/lib/documents/catalog';
import {
  buildBrandKitMarkdown,
  validateBrandKitInput,
} from '@/lib/documents/brand-markdown-builder';

export async function POST(req: NextRequest) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const input = validateBrandKitInput(body);
  if (typeof input === 'string') {
    return NextResponse.json({ error: input }, { status: 400 });
  }

  const space = await getSpaceForUser(userId);
  if (!space) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const def = getDocument('brand-kit');
  if (!def) {
    // Defensive: the catalog should always include brand-kit. If it doesn't,
    // something upstream regressed and we surface it loudly.
    return NextResponse.json({ error: 'brand-kit not in catalog' }, { status: 500 });
  }

  const content = buildBrandKitMarkdown(input);
  const updatedAt = new Date().toISOString();

  const { data: upserted, error: upsertErr } = await supabase
    .from('Document')
    .upsert(
      {
        spaceId: space.id,
        slug: def.slug,
        title: def.title,
        content,
        updatedAt,
      },
      { onConflict: 'spaceId,slug' },
    )
    .select('updatedAt')
    .single();

  if (upsertErr || !upserted) {
    return NextResponse.json({ error: 'Save failed' }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    redirectTo: `/s/${space.slug}/documents/brand-kit?mode=edit`,
    updatedAt: (upserted as { updatedAt: string }).updatedAt,
  });
}
