/**
 * Map a workspace pathname to a friendly label for presence tooltips.
 *
 * Pure URL-to-string logic. Strips the `/s/{slug}` prefix, looks up known
 * top-level surfaces, and falls back to title-casing the segment. Document
 * subroutes return "Document name" derived from the slug.
 */

const TOP_LEVEL: Readonly<Record<string, string>> = {
  '': 'Canvas',
  stages: 'Stages',
  tasks: 'Tasks',
  pulse: 'Pulse',
  memory: 'Memory',
  connections: 'Connections',
  billing: 'Billing',
  documents: 'Documents',
  agents: 'Agents',
  library: 'Library',
  settings: 'Settings',
  inbox: 'Inbox',
  prospects: 'Prospects',
  listings: 'Listings',
};

function titleCase(slug: string): string {
  if (!slug) return '';
  const spaced = slug.replace(/[-_]+/g, ' ').trim();
  return spaced
    .split(' ')
    .map((word, idx) =>
      idx === 0
        ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
        : word.toLowerCase(),
    )
    .join(' ');
}

export function friendlySurface(pathname: string, slug: string): string {
  if (!pathname) return 'Canvas';
  // Strip query/hash if any leaked in.
  const clean = pathname.split('?')[0].split('#')[0];
  const prefix = `/s/${slug}`;
  let rest = clean.startsWith(prefix) ? clean.slice(prefix.length) : clean;
  rest = rest.replace(/^\/+/, '').replace(/\/+$/, '');
  if (rest === '') return 'Canvas';

  const parts = rest.split('/');
  const head = parts[0];

  // /s/{slug}/documents/{doc} → friendly doc name
  if (head === 'documents' && parts[1]) {
    return titleCase(parts[1]);
  }

  // /s/{slug}/tasks/{id} → just "Task". We deliberately don't look up the
  // title; presence is decoration, not a router. Keeps the label
  // synchronous and zero-fetch.
  if (head === 'tasks' && parts[1]) {
    return 'Task';
  }

  // /s/{slug}/stages/{stage} → "Stages · {stage}"? Keep terse — just "Stages".
  if (head in TOP_LEVEL) return TOP_LEVEL[head];

  // Unknown top-level → title-case it.
  return titleCase(head);
}
