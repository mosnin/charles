/**
 * Thin Loops REST API adapter.
 *
 * Transactional sends, lifecycle events, and contact upserts all hit
 * Loops directly here — the manager-layer approval gate decides whether
 * a call ever reaches this adapter, not the adapter itself.
 *
 * Auth: IntegrationConnection (toolkit='loops', status='active') →
 * LOOPS_API_KEY env. Throws when neither is set.
 */

import { supabase } from '@/lib/supabase';

const LOOPS_API = 'https://app.loops.so/api/v1';

async function getLoopsKey(spaceId: string): Promise<string> {
  const { data } = await supabase
    .from('IntegrationConnection')
    .select('accessToken')
    .eq('spaceId', spaceId)
    .eq('toolkit', 'loops')
    .eq('status', 'active')
    .maybeSingle();

  const token = (data as { accessToken?: string } | null)?.accessToken;
  if (token) return token;

  const env = process.env.LOOPS_API_KEY;
  if (env) return env;

  throw new Error(
    `Loops: no API key found for space ${spaceId}. ` +
      `Connect Loops in Settings → Integrations, or set LOOPS_API_KEY.`,
  );
}

function loopsHeaders(key: string): HeadersInit {
  return {
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  };
}

async function readOrThrow(res: Response, action: string): Promise<unknown> {
  if (!res.ok) {
    let body: { message?: string; error?: string } = {};
    try {
      body = (await res.json()) as { message?: string; error?: string };
    } catch {
      // ignore
    }
    const msg = body.message ?? body.error ?? (await res.text().catch(() => ''));
    throw new Error(`Loops ${action} failed: ${res.status} — ${msg}`);
  }
  try {
    return await res.json();
  } catch {
    return {};
  }
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface LoopsContact {
  id?: string;
  email: string;
  firstName?: string;
  lastName?: string;
  subscribed?: boolean;
}

// ── Operations ───────────────────────────────────────────────────────────────

export async function loopsSendTransactional(
  spaceId: string,
  opts: {
    email: string;
    transactionalId: string;
    dataVariables?: Record<string, unknown>;
  },
): Promise<{ success: boolean }> {
  const key = await getLoopsKey(spaceId);
  const payload: Record<string, unknown> = {
    email: opts.email,
    transactionalId: opts.transactionalId,
  };
  if (opts.dataVariables) payload.dataVariables = opts.dataVariables;

  const res = await fetch(`${LOOPS_API}/transactional`, {
    method: 'POST',
    headers: loopsHeaders(key),
    body: JSON.stringify(payload),
  });
  await readOrThrow(res, 'sendTransactional');
  return { success: true };
}

export async function loopsSendEvent(
  spaceId: string,
  opts: {
    email: string;
    eventName: string;
    properties?: Record<string, unknown>;
  },
): Promise<{ success: boolean }> {
  const key = await getLoopsKey(spaceId);
  const payload: Record<string, unknown> = {
    email: opts.email,
    eventName: opts.eventName,
  };
  if (opts.properties) payload.eventProperties = opts.properties;

  const res = await fetch(`${LOOPS_API}/events/send`, {
    method: 'POST',
    headers: loopsHeaders(key),
    body: JSON.stringify(payload),
  });
  await readOrThrow(res, 'sendEvent');
  return { success: true };
}

export async function loopsUpsertContact(
  spaceId: string,
  opts: {
    email: string;
    firstName?: string;
    lastName?: string;
    userId?: string;
    subscribed?: boolean;
  },
): Promise<{ id: string }> {
  const key = await getLoopsKey(spaceId);
  const payload: Record<string, unknown> = {
    email: opts.email,
    subscribed: opts.subscribed ?? true,
  };
  if (opts.firstName) payload.firstName = opts.firstName;
  if (opts.lastName) payload.lastName = opts.lastName;
  if (opts.userId) payload.userId = opts.userId;

  const res = await fetch(`${LOOPS_API}/contacts/update`, {
    method: 'PUT',
    headers: loopsHeaders(key),
    body: JSON.stringify(payload),
  });
  const data = (await readOrThrow(res, 'upsertContact')) as {
    id?: string;
    contactId?: string;
  };
  return { id: data.id ?? data.contactId ?? '' };
}

export async function loopsFindContact(
  spaceId: string,
  email: string,
): Promise<LoopsContact | null> {
  const key = await getLoopsKey(spaceId);
  const url = new URL(`${LOOPS_API}/contacts/find`);
  url.searchParams.set('email', email);

  const res = await fetch(url.toString(), {
    method: 'GET',
    headers: loopsHeaders(key),
  });

  if (res.status === 404) return null;

  const data = (await readOrThrow(res, 'findContact')) as
    | Array<Record<string, unknown>>
    | Record<string, unknown>;

  let contact: Record<string, unknown> | undefined;
  if (Array.isArray(data)) {
    if (data.length === 0) return null;
    contact = data[0];
  } else if (data && typeof data === 'object') {
    contact = data;
  }
  if (!contact || !contact.email) return null;

  return {
    id: contact.id as string | undefined,
    email: contact.email as string,
    firstName: contact.firstName as string | undefined,
    lastName: contact.lastName as string | undefined,
    subscribed: contact.subscribed as boolean | undefined,
  };
}
