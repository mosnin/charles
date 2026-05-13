/**
 * DELETE /api/library/[id] — delete a LibraryFile row and its storage object.
 * Verifies the file belongs to the caller's workspace before touching either.
 */

import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { getSpaceForUser } from '@/lib/space';
import { supabase } from '@/lib/supabase';
import { LIBRARY_BUCKET } from '@/lib/library/types';

type Params = { params: Promise<{ id: string }> };

export async function DELETE(_req: Request, { params }: Params) {
  const { id } = await params;

  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  const space = await getSpaceForUser(userId);
  if (!space) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { data: row, error: lookupErr } = await supabase
    .from('LibraryFile')
    .select('id, spaceId, storagePath')
    .eq('id', id)
    .maybeSingle();
  if (lookupErr) {
    console.error('[library:delete] lookup failed', lookupErr);
    return NextResponse.json({ error: 'Lookup failed' }, { status: 500 });
  }
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if ((row as { spaceId: string }).spaceId !== space.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const storagePath = (row as { storagePath: string }).storagePath;

  // Best-effort storage delete. Even if it fails, drop the row so the
  // founder isn't blocked on an unreachable blob.
  try {
    await supabase.storage.from(LIBRARY_BUCKET).remove([storagePath]);
  } catch (err) {
    console.warn('[library:delete] storage remove failed', err);
  }

  const { error: delErr } = await supabase
    .from('LibraryFile')
    .delete()
    .eq('id', id);
  if (delErr) {
    console.error('[library:delete] delete failed', delErr);
    return NextResponse.json({ error: 'Delete failed' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
