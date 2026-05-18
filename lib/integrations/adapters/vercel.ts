/**
 * Thin Vercel REST API adapter.
 *
 * Reads (listProjects, getEnvVars) execute directly. Writes (setEnvVar,
 * triggerDeployment) are MUTATING — callers must gate them through the
 * approval flow before invoking. This file does not enforce that gate;
 * the runtime that wires the tool does.
 *
 * Auth: IntegrationConnection (toolkit='vercel', status='active') →
 * VERCEL_TOKEN env. Throws when neither is set.
 *
 * Env values are NEVER returned from getEnvVars; we report set/unset only.
 */

import { supabase } from '@/lib/supabase';

const VERCEL_API = 'https://api.vercel.com';

async function getVercelToken(spaceId: string): Promise<string> {
  const { data } = await supabase
    .from('IntegrationConnection')
    .select('accessToken')
    .eq('spaceId', spaceId)
    .eq('toolkit', 'vercel')
    .eq('status', 'active')
    .maybeSingle();

  const token = (data as { accessToken?: string } | null)?.accessToken;
  if (token) return token;

  const env = process.env.VERCEL_TOKEN;
  if (env) return env;

  throw new Error(
    `Vercel: no token found for space ${spaceId}. ` +
      `Connect Vercel in Settings → Integrations, or set VERCEL_TOKEN.`,
  );
}

function vercelHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

async function readOrThrow(res: Response, action: string): Promise<unknown> {
  if (!res.ok) {
    let body: { error?: { message?: string } } = {};
    try {
      body = (await res.json()) as { error?: { message?: string } };
    } catch {
      // ignore
    }
    const msg = body.error?.message ?? (await res.text().catch(() => ''));
    throw new Error(`Vercel ${action} failed: ${res.status} — ${msg}`);
  }
  return res.json();
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface VercelProject {
  id: string;
  name: string;
  framework: string | null;
}

export interface VercelEnvVar {
  key: string;
  marker: 'set' | 'unset';
  target: string[];
}

export interface VercelDeployment {
  id: string;
  url: string;
  state: string | null;
}

// ── Operations ───────────────────────────────────────────────────────────────

export async function vercelListProjects(spaceId: string): Promise<VercelProject[]> {
  const token = await getVercelToken(spaceId);
  const res = await fetch(`${VERCEL_API}/v9/projects?limit=50`, {
    headers: vercelHeaders(token),
  });
  const data = (await readOrThrow(res, 'listProjects')) as {
    projects?: Array<{ id: string; name: string; framework: string | null }>;
  };
  return (data.projects ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    framework: p.framework ?? null,
  }));
}

export async function vercelGetEnvVars(
  spaceId: string,
  projectId: string,
): Promise<VercelEnvVar[]> {
  const token = await getVercelToken(spaceId);
  const res = await fetch(`${VERCEL_API}/v9/projects/${projectId}/env`, {
    headers: vercelHeaders(token),
  });
  const data = (await readOrThrow(res, 'getEnvVars')) as {
    envs?: Array<{ key: string; value?: string; type?: string; target?: string[] }>;
  };
  return (data.envs ?? []).map((e) => ({
    key: e.key,
    marker:
      e.value || (e.type && ['encrypted', 'secret', 'system'].includes(e.type)) ? 'set' : 'unset',
    target: e.target ?? [],
  }));
}

export async function vercelSetEnvVar(
  spaceId: string,
  params: { projectId: string; key: string; value: string; target?: string },
): Promise<{ id: string }> {
  const token = await getVercelToken(spaceId);
  const target = [params.target ?? 'production'];
  const res = await fetch(`${VERCEL_API}/v10/projects/${params.projectId}/env`, {
    method: 'POST',
    headers: vercelHeaders(token),
    body: JSON.stringify({
      key: params.key,
      value: params.value,
      target,
      type: 'encrypted',
    }),
  });
  const data = (await readOrThrow(res, 'setEnvVar')) as { id?: string; created?: { id?: string } };
  const id = data.id ?? data.created?.id ?? '';
  return { id };
}

export async function vercelTriggerDeployment(
  spaceId: string,
  params: { projectId: string; ref?: string },
): Promise<VercelDeployment> {
  const token = await getVercelToken(spaceId);
  // Vercel's create-deployment endpoint requires a project name; the v6
  // endpoint accepts a project id via `project` param + `gitSource`.
  const res = await fetch(`${VERCEL_API}/v13/deployments`, {
    method: 'POST',
    headers: vercelHeaders(token),
    body: JSON.stringify({
      project: params.projectId,
      gitSource: { type: 'github', ref: params.ref ?? 'main' },
    }),
  });
  const data = (await readOrThrow(res, 'triggerDeployment')) as {
    id?: string;
    url?: string;
    readyState?: string;
  };
  return {
    id: data.id ?? '',
    url: data.url ?? '',
    state: data.readyState ?? null,
  };
}
