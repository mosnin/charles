import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { requireAuth, requireContactAccess } from '@/lib/api-auth';
import { getSpaceForUser } from '@/lib/space';
import { DOCUMENTS } from '@/lib/documents/catalog';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

/**
 * POST — Upload a document for a contact.
 * Stores metadata in ContactDocument table. In production, the file binary
 * would go to S3/R2. For now we store a base64 data URL as the storageKey
 * (suitable for small files and MVP).
 */
export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const contactId = formData.get('contactId') as string;
  const file = formData.get('file') as File;
  const uploadedBy = (formData.get('uploadedBy') as string) || 'agent';

  if (!contactId || !file) {
    return NextResponse.json({ error: 'contactId and file required' }, { status: 400 });
  }

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: 'File too large (max 10MB)' }, { status: 400 });
  }

  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json({ error: 'File type not supported' }, { status: 400 });
  }

  // Validate file magic numbers to prevent MIME spoofing.
  // WEBP magic is "WEBP" at bytes 8-11, so we need 12 bytes.
  const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const isPdf = header[0] === 0x25 && header[1] === 0x50 && header[2] === 0x44 && header[3] === 0x46; // %PDF
  const isJpeg = header[0] === 0xFF && header[1] === 0xD8;
  const isPng = header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4E && header[3] === 0x47;
  const isWebp = header.length >= 12 && header[8] === 0x57 && header[9] === 0x45 && header[10] === 0x42 && header[11] === 0x50; // WEBP at offset 8
  const isDoc = header[0] === 0xD0 && header[1] === 0xCF; // OLE2 (DOC)
  const isDocx = header[0] === 0x50 && header[1] === 0x4B; // ZIP (DOCX)
  if (!isPdf && !isJpeg && !isPng && !isWebp && !isDoc && !isDocx) {
    return NextResponse.json({ error: 'File content does not match declared type' }, { status: 400 });
  }

  // Verify access — guest uploads are restricted to recently-created public
  // intake contacts to prevent arbitrary file uploads to any contact.
  // NOTE: resolvedUploadedBy is derived from the auth path taken, NOT from the
  // request body, to prevent callers from spoofing the uploadedBy value.
  let resolvedSpaceId: string;
  let resolvedUploadedBy: string;
  if (uploadedBy === 'guest') {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { data: guestContact } = await supabase
      .from('Contact')
      .select('spaceId')
      .eq('id', contactId)
      .contains('tags', ['application-link'])
      .gte('createdAt', fiveMinAgo)
      .maybeSingle();
    if (!guestContact) {
      return NextResponse.json({ error: 'Contact not found or upload window expired' }, { status: 404 });
    }
    resolvedSpaceId = guestContact.spaceId;
    resolvedUploadedBy = 'guest';
  } else {
    const auth = await requireContactAccess(contactId);
    if (auth instanceof NextResponse) return auth;

    const { data: authedContact } = await supabase
      .from('Contact')
      .select('spaceId')
      .eq('id', contactId)
      .single();
    if (!authedContact) {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
    }
    resolvedSpaceId = authedContact.spaceId;
    resolvedUploadedBy = 'agent';
  }

  // Store file as base64 data URL (MVP approach — replace with S3 in production)
  const buffer = await file.arrayBuffer();
  const base64 = Buffer.from(buffer).toString('base64');
  const storageKey = `data:${file.type};base64,${base64}`;

  const { data: doc, error } = await supabase
    .from('ContactDocument')
    .insert({
      contactId,
      spaceId: resolvedSpaceId,
      fileName: file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 255),
      fileType: file.type,
      fileSize: file.size,
      storageKey,
      uploadedBy: resolvedUploadedBy,
    })
    .select('id, fileName, fileType, fileSize, createdAt')
    .single();

  if (error) {
    console.error('[documents] insert failed', error);
    return NextResponse.json({ error: 'Failed to save document' }, { status: 500 });
  }

  return NextResponse.json(doc, { status: 201 });
}

/**
 * GET — Two shapes, one endpoint:
 *
 *   1. `?contactId=...` — legacy: lists ContactDocument rows uploaded against
 *      a contact (intake attachments, signed forms, etc).
 *
 *   2. No params — workspace documents: returns the nine canonical docs for
 *      the caller's Charles workspace, left-joined with the catalog so every
 *      slug appears even if the DB row hasn't been created yet. Empty docs
 *      report `hasContent: false` and `updatedAt: null`.
 */
export async function GET(req: NextRequest) {
  const contactId = req.nextUrl.searchParams.get('contactId');

  // ── Legacy: contact attachments ────────────────────────────────────────────
  if (contactId) {
    const auth = await requireContactAccess(contactId);
    if (auth instanceof NextResponse) return auth;

    const { data: docs } = await supabase
      .from('ContactDocument')
      .select('id, fileName, fileType, fileSize, uploadedBy, createdAt')
      .eq('contactId', contactId)
      .order('createdAt', { ascending: false });

    return NextResponse.json(docs ?? []);
  }

  // ── Workspace documents (the nine) ─────────────────────────────────────────
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
