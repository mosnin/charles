'use client';

/**
 * LibraryTab — reference material drop zone inside the chat dock.
 *
 * Shows the founder's uploaded files (newest first). Click a row to open
 * a 60s signed URL in a new tab. The Upload button posts to
 * /api/library/upload and optimistically inserts the resulting row.
 *
 * Future iterations let agents pull these as context — for now this is
 * pure storage + retrieval.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { FileText, Image as ImageIcon, FileAudio, FileVideo, File as FileIcon, Trash2, Upload } from 'lucide-react';
import { cn } from '@/lib/utils';
import { MONO_META } from '@/lib/typography';
import { timeAgo } from '@/lib/formatting';
import { formatBytes } from '@/lib/library/kinds';
import type { LibraryFile } from '@/lib/library/types';
import type { LibraryKind } from '@/lib/library/kinds';

export function LibraryTab() {
  const [files, setFiles] = useState<LibraryFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/library', { cache: 'no-store' });
      if (!res.ok) {
        setError('Could not load library.');
        return;
      }
      const data = (await res.json()) as LibraryFile[];
      setFiles(Array.isArray(data) ? data : []);
      setError(null);
    } catch {
      setError('Could not load library.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handlePick = useCallback(() => inputRef.current?.click(), []);

  const handleFile = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file) return;
      setUploading(true);
      setError(null);
      const fd = new FormData();
      fd.append('file', file);
      try {
        const res = await fetch('/api/library/upload', { method: 'POST', body: fd });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          setError(body.error ?? 'Upload failed.');
          return;
        }
        const row = (await res.json()) as LibraryFile;
        setFiles((prev) => [row, ...prev]);
      } catch {
        setError('Upload failed.');
      } finally {
        setUploading(false);
      }
    },
    [],
  );

  const openFile = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/library/${id}/url`, { cache: 'no-store' });
      if (!res.ok) return;
      const { url } = (await res.json()) as { url: string };
      if (url) window.open(url, '_blank', 'noopener,noreferrer');
    } catch {
      // Best-effort.
    }
  }, []);

  const deleteFile = useCallback(async (id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
    try {
      await fetch(`/api/library/${id}`, { method: 'DELETE' });
    } catch {
      // If the delete fails the row will reappear on the next refresh.
      void refresh();
    }
  }, [refresh]);

  return (
    <div className="flex h-full flex-col" data-testid="library-tab">
      <div className="flex items-center justify-between pb-3">
        <span className="text-[12px] uppercase tracking-wide text-slate-400">Library</span>
        <button
          type="button"
          onClick={handlePick}
          disabled={uploading}
          data-testid="library-upload-btn"
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 py-1 text-[12px] text-slate-700 hover:border-slate-400 disabled:opacity-50"
        >
          <Upload size={12} />
          {uploading ? 'Uploading…' : 'Upload'}
        </button>
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          onChange={handleFile}
          data-testid="library-file-input"
        />
      </div>

      {error && (
        <div className="mb-2 rounded-md border border-rose-200 bg-rose-50 px-2 py-1.5 text-[12px] text-rose-700" data-testid="library-error">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-[12px] text-slate-400">Loading…</div>
      ) : files.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center text-center" data-testid="library-empty">
          <div className="text-[13px] text-slate-500">
            Drop reference material here — docs, screenshots, brand assets.
          </div>
          <div className="mt-1 text-[12px] text-slate-400">
            Agents will use it as context.
          </div>
        </div>
      ) : (
        <ul className="space-y-1" data-testid="library-list">
          {files.map((f) => (
            <li key={f.id}>
              <div className="group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-slate-50">
                <button
                  type="button"
                  onClick={() => openFile(f.id)}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  data-testid={`library-row-${f.id}`}
                >
                  <KindIcon kind={f.kind} />
                  <span className="min-w-0 flex-1 truncate text-[12px] text-slate-800">
                    {f.name}
                  </span>
                  <span className={cn(MONO_META, 'flex-shrink-0 text-slate-400')}>
                    {formatBytes(f.sizeBytes)}
                  </span>
                  <span className={cn(MONO_META, 'flex-shrink-0 text-slate-400')}>
                    {timeAgo(f.createdAt)}
                  </span>
                </button>
                <button
                  type="button"
                  aria-label={`Delete ${f.name}`}
                  onClick={() => deleteFile(f.id)}
                  data-testid={`library-delete-${f.id}`}
                  className="invisible flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md text-slate-400 hover:text-rose-600 group-hover:visible"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function KindIcon({ kind }: { kind: LibraryKind }) {
  const cls = 'h-4 w-4 flex-shrink-0 text-slate-500';
  if (kind === 'image') return <ImageIcon className={cls} aria-hidden />;
  if (kind === 'audio') return <FileAudio className={cls} aria-hidden />;
  if (kind === 'video') return <FileVideo className={cls} aria-hidden />;
  if (kind === 'document') return <FileText className={cls} aria-hidden />;
  return <FileIcon className={cls} aria-hidden />;
}
