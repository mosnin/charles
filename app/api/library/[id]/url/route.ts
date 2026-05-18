/**
 * GET /api/library/[id]/url — return a 60s signed URL for the file's
 * storage object. The Library tab uses this to open files in a new tab
 * without exposing the bucket publicly.
 */

import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { getSpaceForUser } from '@/lib/space';
import { supabase } from '@/lib/supabase';
import { LIBRARY_BUCKET } from '@/lib/library/types';

type Params = { params: Promise<{ id: string }> };
const SIGNED_URL_TTL_S = 60;

export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;

  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  const space = await getSpaceForUser(userId);
  if (!space) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { data: row, error } = await supabase
    .from('LibraryFile')
    .select('id, spaceId, storagePath, name, mimeType')
    .eq('id', id)
    .maybeSingle();
  if (error) {
    console.error('[library:url] lookup failed', error);
    return NextResponse.json({ error: 'Lookup failed' }, { status: 500 });
  }
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if ((row as { spaceId: string }).spaceId !== space.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const storagePath = (row as { storagePath: string }).storagePath;
  const { data: signed, error: signErr } = await supabase.storage
    .from(LIBRARY_BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_TTL_S);
  if (signErr || !signed?.signedUrl) {
    console.error('[library:url] sign failed', signErr);
    return NextResponse.json({ error: 'Could not sign URL' }, { status: 500 });
  }

  return NextResponse.json({ url: signed.signedUrl, expiresIn: SIGNED_URL_TTL_S });
}
