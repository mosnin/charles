/**
 * GET  /api/documents/[slug] — fetch a workspace document.
 * PATCH /api/documents/[slug] — upsert a workspace document's markdown.
 *
 * The catalog defines the nine canonical slugs. The DB has a matching CHECK
 * constraint plus a (spaceId, slug) UNIQUE — so upserts and slug validation
 * line up at every layer.
 *
 * GET returns the row when it exists, otherwise the catalog default with
 * `content: ''` and `updatedAt: null`. We deliberately do NOT auto-create
 * a row on GET — the onboarding seed function (`seed_workspace_documents`)
 * owns workspace setup. Only PATCH writes.
 *
 * Auth: caller must own the space (resolved via getSpaceForUser).
 *
 * 200 GET:    { slug, title, blurb, group, content, updatedAt: string | null }
 * 200 PATCH:  { updatedAt }
 * 400:        bad body
 * 401:        unauthenticated
 * 403:        caller has no space
 * 404:        unknown slug
 * 500:        DB failure
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { requireAuth } from '@/lib/api-auth';
import { getSpaceForUser } from '@/lib/space';
import { getDocument } from '@/lib/documents/catalog';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  const { slug } = await params;
  const def = getDocument(slug);
  if (!def) {
    return NextResponse.json({ error: 'Unknown document' }, { status: 404 });
  }

  const space = await getSpaceForUser(userId);
  if (!space) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { data: row, error } = await supabase
    .from('Document')
    .select('content, updatedAt')
    .eq('spaceId', space.id)
    .eq('slug', slug)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: 'Lookup failed' }, { status: 500 });
  }

  return NextResponse.json({
    slug: def.slug,
    title: def.title,
    blurb: def.blurb,
    group: def.group,
    content: (row as { content?: string } | null)?.content ?? '',
    updatedAt: (row as { updatedAt?: string } | null)?.updatedAt ?? null,
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  const { slug } = await params;
  const def = getDocument(slug);
  if (!def) {
    return NextResponse.json({ error: 'Unknown document' }, { status: 404 });
  }

  let body: { content?: unknown };
  try {
    body = (await req.json()) as { content?: unknown };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (typeof body.content !== 'string') {
    return NextResponse.json(
      { error: 'content (string) is required' },
      { status: 400 },
    );
  }
  const content = body.content;

  const space = await getSpaceForUser(userId);
  if (!space) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const updatedAt = new Date().toISOString();

  // UPSERT on (spaceId, slug). The UNIQUE constraint backs this.
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
    updatedAt: (upserted as { updatedAt: string }).updatedAt,
  });
}
