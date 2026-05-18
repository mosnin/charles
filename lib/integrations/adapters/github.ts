/**
 * Thin GitHub REST API adapter.
 *
 * Auth priority:
 *   1. IntegrationConnection row for (spaceId, toolkit='github') — the
 *      founder's OAuth token stored after the GitHub OAuth connect flow.
 *   2. process.env.GITHUB_TOKEN — service-level fallback for dev / CI.
 *
 * All calls use the 2022-11-28 API version and return typed results. Errors
 * throw with enough context to diagnose (status code + GitHub error body).
 *
 * This adapter does NOT go through Composio — GitHub is wired directly
 * because the operations we need (create repo, push file, open PR) require
 * the full REST surface, not the subset Composio exposes.
 */

import { supabase } from '@/lib/supabase';

const GH_API = 'https://api.github.com';
const GH_VERSION = '2022-11-28';

function githubHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': GH_VERSION,
  };
}

async function getGitHubToken(spaceId: string): Promise<string> {
  // Prefer the founder's OAuth token from IntegrationConnection.
  const { data } = await supabase
    .from('IntegrationConnection')
    .select('composioConnectionId, status')
    .eq('spaceId', spaceId)
    .eq('toolkit', 'github')
    .eq('status', 'active')
    .maybeSingle();

  // IntegrationConnection stores the Composio connection id, not the raw
  // OAuth token — for GitHub we need the raw token. When the founder
  // connects GitHub directly (not through Composio) we store it as a
  // separate column or in metadata. Until that custom OAuth flow exists,
  // we fall back to the env var.
  //
  // TODO: When the direct GitHub OAuth flow lands, read the token from
  // IntegrationConnection.metadata.accessToken here instead.
  if (data) {
    const envToken = process.env.GITHUB_TOKEN;
    if (envToken) return envToken;
  }

  const envToken = process.env.GITHUB_TOKEN;
  if (envToken) return envToken;

  throw new Error(
    `GitHub: no access token found for space ${spaceId}. ` +
      `Connect GitHub in Settings → Integrations, or set GITHUB_TOKEN in your environment.`,
  );
}

async function ghFetch(
  token: string,
  path: string,
  options?: RequestInit,
): Promise<Response> {
  return fetch(`${GH_API}${path}`, {
    ...options,
    headers: {
      ...githubHeaders(token),
      ...(options?.headers ?? {}),
    },
  });
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface RepoResult {
  url: string;
  cloneUrl: string;
  owner: string;
  name: string;
}

export interface PRResult {
  url: string;
  number: number;
}

// ── Operations ───────────────────────────────────────────────────────────────

/**
 * Create a new GitHub repository under the authenticated user's account.
 * auto_init: true so the repo has a default branch immediately.
 */
export async function githubCreateRepo(
  spaceId: string,
  params: {
    name: string;
    description?: string;
    private?: boolean;
  },
): Promise<RepoResult> {
  const token = await getGitHubToken(spaceId);
  const res = await ghFetch(token, '/user/repos', {
    method: 'POST',
    body: JSON.stringify({
      name: params.name,
      description: params.description ?? '',
      private: params.private ?? false,
      auto_init: true,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`GitHub createRepo failed: ${res.status} — ${JSON.stringify(err)}`);
  }

  const data = await res.json();
  return {
    url: data.html_url as string,
    cloneUrl: data.clone_url as string,
    owner: (data.owner as { login: string }).login,
    name: data.name as string,
  };
}

/**
 * Create or update a file in a repository.
 *
 * @param params.repo  Full "owner/repo" string, e.g. "acme/my-app".
 */
export async function githubCreateFile(
  spaceId: string,
  params: {
    repo: string;
    path: string;
    content: string;
    message: string;
    branch?: string;
  },
): Promise<void> {
  const token = await getGitHubToken(spaceId);
  const [owner, repo] = params.repo.split('/');
  const encoded = Buffer.from(params.content).toString('base64');

  const res = await ghFetch(
    token,
    `/repos/${owner}/${repo}/contents/${params.path}`,
    {
      method: 'PUT',
      body: JSON.stringify({
        message: params.message,
        content: encoded,
        branch: params.branch ?? 'main',
      }),
    },
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`GitHub createFile failed: ${res.status} — ${JSON.stringify(err)}`);
  }
}

/**
 * Open a pull request.
 *
 * @param params.repo  Full "owner/repo" string.
 * @param params.head  Source branch name.
 * @param params.base  Target branch. Defaults to "main".
 */
export async function githubOpenPR(
  spaceId: string,
  params: {
    repo: string;
    title: string;
    body: string;
    head: string;
    base?: string;
  },
): Promise<PRResult> {
  const token = await getGitHubToken(spaceId);
  const [owner, repo] = params.repo.split('/');

  const res = await ghFetch(token, `/repos/${owner}/${repo}/pulls`, {
    method: 'POST',
    body: JSON.stringify({
      title: params.title,
      body: params.body,
      head: params.head,
      base: params.base ?? 'main',
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`GitHub openPR failed: ${res.status} — ${JSON.stringify(err)}`);
  }

  const data = await res.json();
  return {
    url: data.html_url as string,
    number: data.number as number,
  };
}

/**
 * Read a file from a repository. Returns the decoded UTF-8 content string.
 *
 * @param params.repo    Full "owner/repo" string.
 * @param params.branch  Git ref to read from. Defaults to "main".
 */
export async function githubReadFile(
  spaceId: string,
  params: {
    repo: string;
    path: string;
    branch?: string;
  },
): Promise<string> {
  const token = await getGitHubToken(spaceId);
  const [owner, repo] = params.repo.split('/');
  const ref = params.branch ?? 'main';

  const res = await ghFetch(
    token,
    `/repos/${owner}/${repo}/contents/${params.path}?ref=${ref}`,
    { method: 'GET' },
  );

  if (!res.ok) {
    throw new Error(`GitHub readFile failed: ${res.status} — ${params.repo}/${params.path}@${ref}`);
  }

  const data = await res.json();
  return Buffer.from(data.content as string, 'base64').toString('utf-8');
}
