/**
 * Library file types — wire shape used by both the API routes and the
 * client tab. The LibraryFile row maps 1:1 to the DB column casing
 * (camelCase) so we don't have to remap on each fetch.
 */

import type { LibraryKind } from './kinds';

export interface LibraryFile {
  id: string;
  spaceId: string;
  uploaderId: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
  kind: LibraryKind;
  description: string;
  createdAt: string;
}

export const LIBRARY_BUCKET = 'library';
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_SPACE_BYTES = 1024 * 1024 * 1024;
