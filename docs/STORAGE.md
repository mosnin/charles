# Storage buckets

Charles stores user-uploaded blobs in two Supabase Storage buckets. The app
creates them lazily on first upload, but if your Supabase project locks
down storage admin you may need to create them manually.

## `branding` (public)

Logos, photos, favicons. Public-read because they ship in the marketing
site / hosted forms. Created by `/api/upload`.

## `library` (private)

The chat dock's "Library" tab — reference material the founder drops in
for agents to use as context. Private. Access is gated by signed URLs
issued by `GET /api/library/[id]/url` (60s TTL).

Per-file cap: 25 MB. Per-space cap: 1 GB.

## Creating a bucket manually

If you see "bucket does not exist" errors in the logs, create it in the
Supabase Dashboard:

1. Storage → New bucket
2. Name: `library`
3. Public: off
4. File size limit: 25 MB

The `library` table (`LibraryFile`) is created by migration
`20260606000012_charles_library_files.sql`. The bucket itself lives
outside Postgres so it can't be created by SQL — the migration is a
no-op marker that the table exists.
