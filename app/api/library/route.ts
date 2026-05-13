/**
 * GET /api/library — list LibraryFile rows for the founder's workspace.
 * Sorted by createdAt DESC. Used by the chat dock's Library tab.
 */

import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { getSpaceForUser } from '@/lib/space';
import { supabase } from '@/lib/supabase';

export async function GET() {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  const space = await getSpaceForUser(userId);
  if (!space) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { data, error } = await supabase
    .from('LibraryFile')
    .select('*')
    .eq('spaceId', space.id)
    .order('createdAt', { ascending: false });

  if (error) {
    console.error('[library:list] query failed', error);
    return NextResponse.json({ error: 'Could not load library' }, { status: 500 });
  }

  return NextResponse.json(data ?? []);
}
