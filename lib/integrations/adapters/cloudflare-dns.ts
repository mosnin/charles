/**
 * Thin Cloudflare DNS + Registrar (availability-only) adapter.
 *
 * Reads + DNS CRUD execute directly against Cloudflare's API. Domain
 * registration deliberately does NOT — Phase 4 ships availability +
 * approval-string-only; actual purchase requires a separate gated flow
 * that handles money. `cloudflareRegisterDomain` returns a stub.
 *
 * Auth: IntegrationConnection (toolkit='cloudflare_dns', status='active')
 * → CLOUDFLARE_API_TOKEN env. Throws when neither is set.
 */

import { supabase } from '@/lib/supabase';

const CF_API = 'https://api.cloudflare.com/client/v4';

async function getCloudflareToken(spaceId: string): Promise<string> {
  const { data } = await supabase
    .from('IntegrationConnection')
    .select('accessToken')
    .eq('spaceId', spaceId)
    .eq('toolkit', 'cloudflare_dns')
    .eq('status', 'active')
    .maybeSingle();

  const token = (data as { accessToken?: string } | null)?.accessToken;
  if (token) return token;

  const env = process.env.CLOUDFLARE_API_TOKEN;
  if (env) return env;

  throw new Error(
    `Cloudflare: no API token found for space ${spaceId}. ` +
      `Connect Cloudflare in Settings → Integrations, or set CLOUDFLARE_API_TOKEN.`,
  );
}

function cfHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

async function readOrThrow(res: Response, action: string): Promise<unknown> {
  if (!res.ok) {
    let body: { errors?: Array<{ message?: string }> } = {};
    try {
      body = (await res.json()) as { errors?: Array<{ message?: string }> };
    } catch {
      // ignore
    }
    const msg =
      body.errors?.[0]?.message ?? (await res.text().catch(() => ''));
    throw new Error(`Cloudflare ${action} failed: ${res.status} — ${msg}`);
  }
  return res.json();
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface CloudflareZone {
  id: string;
  name: string;
}

export interface CloudflareRecord {
  id: string;
  type: string;
  name: string;
  content: string;
  ttl: number;
  proxied: boolean;
}

export interface DomainAvailability {
  status: 'available' | 'unavailable' | 'unknown';
  price?: number;
  currency?: string;
}

export interface DomainRegistrationStub {
  requiresApproval: true;
  message: string;
}

// ── Operations ───────────────────────────────────────────────────────────────

export async function cloudflareListZones(
  spaceId: string,
): Promise<CloudflareZone[]> {
  const token = await getCloudflareToken(spaceId);
  const res = await fetch(`${CF_API}/zones`, {
    method: 'GET',
    headers: cfHeaders(token),
  });
  const data = (await readOrThrow(res, 'listZones')) as {
    result?: Array<{ id: string; name: string }>;
  };
  return (data.result ?? []).map((z) => ({ id: z.id, name: z.name }));
}

export async function cloudflareListRecords(
  spaceId: string,
  opts: { zoneId: string; type?: string },
): Promise<CloudflareRecord[]> {
  const token = await getCloudflareToken(spaceId);
  const url = new URL(`${CF_API}/zones/${opts.zoneId}/dns_records`);
  if (opts.type) url.searchParams.set('type', opts.type.toUpperCase());

  const res = await fetch(url.toString(), {
    method: 'GET',
    headers: cfHeaders(token),
  });
  const data = (await readOrThrow(res, 'listRecords')) as {
    result?: Array<Record<string, unknown>>;
  };
  return (data.result ?? []).map((r) => ({
    id: r.id as string,
    type: r.type as string,
    name: r.name as string,
    content: r.content as string,
    ttl: (r.ttl as number) ?? 1,
    proxied: (r.proxied as boolean) ?? false,
  }));
}

export async function cloudflareCreateRecord(
  spaceId: string,
  opts: {
    zoneId: string;
    type: string;
    name: string;
    content: string;
    ttl?: number;
    proxied?: boolean;
  },
): Promise<CloudflareRecord> {
  const token = await getCloudflareToken(spaceId);
  const res = await fetch(`${CF_API}/zones/${opts.zoneId}/dns_records`, {
    method: 'POST',
    headers: cfHeaders(token),
    body: JSON.stringify({
      type: opts.type.toUpperCase(),
      name: opts.name,
      content: opts.content,
      ttl: opts.ttl ?? 1,
      proxied: opts.proxied ?? false,
    }),
  });
  const data = (await readOrThrow(res, 'createRecord')) as {
    result?: Record<string, unknown>;
  };
  const r = data.result ?? {};
  return {
    id: r.id as string,
    type: r.type as string,
    name: r.name as string,
    content: r.content as string,
    ttl: (r.ttl as number) ?? 1,
    proxied: (r.proxied as boolean) ?? false,
  };
}

export async function cloudflareUpdateRecord(
  spaceId: string,
  opts: {
    zoneId: string;
    recordId: string;
    content: string;
    ttl?: number;
    proxied?: boolean;
  },
): Promise<CloudflareRecord> {
  const token = await getCloudflareToken(spaceId);
  const res = await fetch(
    `${CF_API}/zones/${opts.zoneId}/dns_records/${opts.recordId}`,
    {
      method: 'PATCH',
      headers: cfHeaders(token),
      body: JSON.stringify({
        content: opts.content,
        ttl: opts.ttl ?? 1,
        proxied: opts.proxied ?? false,
      }),
    },
  );
  const data = (await readOrThrow(res, 'updateRecord')) as {
    result?: Record<string, unknown>;
  };
  const r = data.result ?? {};
  return {
    id: r.id as string,
    type: r.type as string,
    name: r.name as string,
    content: r.content as string,
    ttl: (r.ttl as number) ?? 1,
    proxied: (r.proxied as boolean) ?? false,
  };
}

export async function cloudflareDeleteRecord(
  spaceId: string,
  opts: { zoneId: string; recordId: string },
): Promise<{ id: string }> {
  const token = await getCloudflareToken(spaceId);
  const res = await fetch(
    `${CF_API}/zones/${opts.zoneId}/dns_records/${opts.recordId}`,
    {
      method: 'DELETE',
      headers: cfHeaders(token),
    },
  );
  const data = (await readOrThrow(res, 'deleteRecord')) as {
    result?: { id?: string };
  };
  return { id: data.result?.id ?? opts.recordId };
}

export async function cloudflareCheckDomainAvailability(
  spaceId: string,
  domain: string,
): Promise<DomainAvailability> {
  const token = await getCloudflareToken(spaceId);
  const res = await fetch(`${CF_API}/domains/${domain}/check`, {
    method: 'GET',
    headers: cfHeaders(token),
  });
  const data = (await readOrThrow(res, 'checkDomainAvailability')) as {
    result?: { available?: boolean; price?: number; currency?: string };
  };
  const r = data.result ?? {};
  let status: DomainAvailability['status'];
  if (r.available === true) status = 'available';
  else if (r.available === false) status = 'unavailable';
  else status = 'unknown';

  return {
    status,
    price: r.price,
    currency: r.currency,
  };
}

/**
 * Domain registration is intentionally NOT executed in Phase 4. The agent
 * surfaces an approval stub so the founder completes payment via
 * Cloudflare Registrar directly. No fetch call is made.
 */
export async function cloudflareRegisterDomain(
  _spaceId: string,
  opts: { domain: string; years?: number },
): Promise<DomainRegistrationStub> {
  const years = opts.years ?? 1;
  return {
    requiresApproval: true,
    message:
      `ACTION REQUIRES APPROVAL: register ${opts.domain} for ${years} year(s). ` +
      `The founder must complete payment manually via Cloudflare Registrar.`,
  };
}
