import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { requireAuth } from '@/lib/api-auth';
import { getSpaceForUser } from '@/lib/space';
import { DOCUMENTS } from '@/lib/documents/catalog';

/**
 * GET — Returns the canonical Charles workspace documents, left-joined with
 * the catalog so every slug appears even if the DB row hasn't been created
 * yet. Empty docs report `hasContent: false` and `updatedAt: null`.
 *
 * The realtor-era `?contactId=...` branch (ContactDocument intake
 * attachments) and the corresponding POST upload were removed with the
 * Contact / ContactDocument tables.
 */
export async function GET(_req: NextRequest) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  const space = await getSpaceForUser(userId);
  if (!space) {
    return NextResponse.json({ error: 'No workspace' }, { status: 403 });
  }

  let rows: { slug: string; content: string | null; updatedAt: string | null }[] = [];
  try {
    const { data, error } = await supabase
      .from('Document')
      .select('slug, content, updatedAt')
      .eq('spaceId', space.id);
    if (error) throw error;
    rows = (data ?? []) as typeof rows;
  } catch (err) {
    console.error('[documents] workspace fetch failed', err);
    return NextResponse.json({ error: 'Failed to load documents' }, { status: 500 });
  }

  const bySlug = new Map(rows.map((r) => [r.slug, r]));

  const documents = DOCUMENTS.map((def) => {
    const row = bySlug.get(def.slug);
    const content = row?.content ?? '';
    return {
      slug: def.slug,
      title: def.title,
      blurb: def.blurb,
      group: def.group,
      hasContent: content.trim().length > 0,
      updatedAt: row?.updatedAt ?? null,
    };
  });

  return NextResponse.json({ documents });
}
