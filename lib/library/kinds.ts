/**
 * Library file kind helpers — small mapping from MIME type to a coarse kind
 * the UI can show as an icon. Kept here so server and client agree on the
 * categorization without re-importing each other's modules.
 */

export type LibraryKind = 'document' | 'image' | 'audio' | 'video' | 'other';

export function kindFromMime(mime: string): LibraryKind {
  if (!mime) return 'other';
  const m = mime.toLowerCase();
  if (m.startsWith('image/')) return 'image';
  if (m.startsWith('audio/')) return 'audio';
  if (m.startsWith('video/')) return 'video';
  if (
    m === 'application/pdf' ||
    m.startsWith('text/') ||
    m.includes('word') ||
    m.includes('spreadsheet') ||
    m.includes('presentation') ||
    m === 'application/json' ||
    m === 'application/rtf'
  ) {
    return 'document';
  }
  return 'other';
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
