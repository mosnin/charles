/**
 * POST /api/library/upload — multipart upload of a single file into the
 * founder's library. Reads the file from formData, uploads to the
 * `library` storage bucket (private), inserts a LibraryFile row. Returns
 * the new row. Enforces 25MB per-file and 1GB per-space caps.
 */

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { requireAuth } from '@/lib/api-auth';
import { getSpaceForUser } from '@/lib/space';
import { supabase } from '@/lib/supabase';
import { kindFromMime } from '@/lib/library/kinds';
import { LIBRARY_BUCKET, MAX_FILE_BYTES, MAX_SPACE_BYTES } from '@/lib/library/types';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  const space = await getSpaceForUser(userId);
  if (!space) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  let file: File | null = null;
  let description = '';
  try {
    const formData = await req.formData();
    const f = formData.get('file');
    if (f && typeof f !== 'string') file = f as File;
    const d = formData.get('description');
    if (typeof d === 'string') description = d.slice(0, 500);
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 });
  }

  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });

  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json(
      { error: `File exceeds the 25MB per-file limit.` },
      { status: 413 },
    );
  }

  // Per-space quota check. Defensive: we re-sum on every upload to catch
  // drift between the row sizes and the actual storage usage.
  const { data: existing, error: sumErr } = await supabase
    .from('LibraryFile')
    .select('sizeBytes')
    .eq('spaceId', space.id);
  if (sumErr) {
    console.error('[library:upload] quota query failed', sumErr);
    return NextResponse.json({ error: 'Storage check failed' }, { status: 500 });
  }
  const used = (existing ?? []).reduce(
    (sum, row) => sum + (Number((row as { sizeBytes?: number }).sizeBytes) || 0),
    0,
  );
  if (used + file.size > MAX_SPACE_BYTES) {
    return NextResponse.json(
      { error: 'Workspace library is full (1GB cap).' },
      { status: 507 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const safeName = sanitizeName(file.name || 'upload');
  const storagePath = `${space.id}/${crypto.randomUUID()}-${safeName}`;

  // Ensure bucket exists (private). Skip on errors — the upload call will
  // surface a clearer error if the bucket genuinely can't be reached.
  try {
    const { data: buckets } = await supabase.storage.listBuckets();
    if (!buckets?.find((b) => b.name === LIBRARY_BUCKET)) {
      await supabase.storage.createBucket(LIBRARY_BUCKET, { public: false });
    }
  } catch (err) {
    console.warn('[library:upload] bucket ensure failed', err);
  }

  const { error: uploadErr } = await supabase.storage
    .from(LIBRARY_BUCKET)
    .upload(storagePath, buffer, {
      contentType: file.type || 'application/octet-stream',
      upsert: false,
    });
  if (uploadErr) {
    console.error('[library:upload] storage upload failed', uploadErr);
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }

  const row = {
    spaceId: space.id,
    uploaderId: userId,
    name: file.name || 'upload',
    mimeType: file.type || 'application/octet-stream',
    sizeBytes: file.size,
    storagePath,
    kind: kindFromMime(file.type || ''),
    description,
  };

  const { data: inserted, error: insertErr } = await supabase
    .from('LibraryFile')
    .insert(row)
    .select('*')
    .single();
  if (insertErr || !inserted) {
    // Roll back the storage object so we don't leak orphaned blobs.
    await supabase.storage.from(LIBRARY_BUCKET).remove([storagePath]).catch(() => {});
    console.error('[library:upload] insert failed', insertErr);
    return NextResponse.json({ error: 'Could not save file' }, { status: 500 });
  }

  return NextResponse.json(inserted, { status: 200 });
}

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
}
