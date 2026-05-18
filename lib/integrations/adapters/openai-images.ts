/**
 * Thin OpenAI Images REST adapter — generation + edit.
 *
 * No openai SDK dependency: the surface we use (two endpoints) doesn't
 * justify the install. Returns URLs (or data: URIs for b64 responses)
 * normalized into `{ urls: string[] }` so callers don't branch on
 * response shape.
 *
 * Auth: IntegrationConnection (toolkit='openai', status='active') →
 * OPENAI_API_KEY env. Throws when neither is set.
 */

import { supabase } from '@/lib/supabase';

const OPENAI_API = 'https://api.openai.com/v1';
const MAX_N = 4;

async function getOpenAIKey(spaceId: string): Promise<string> {
  const { data } = await supabase
    .from('IntegrationConnection')
    .select('accessToken')
    .eq('spaceId', spaceId)
    .eq('toolkit', 'openai')
    .eq('status', 'active')
    .maybeSingle();

  const token = (data as { accessToken?: string } | null)?.accessToken;
  if (token) return token;

  const env = process.env.OPENAI_API_KEY;
  if (env) return env;

  throw new Error(
    `OpenAI: no API key found for space ${spaceId}. ` +
      `Connect OpenAI in Settings → Integrations, or set OPENAI_API_KEY.`,
  );
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
    throw new Error(`OpenAI ${action} failed: ${res.status} — ${msg}`);
  }
  return res.json();
}

interface RawImageItem {
  url?: string;
  b64_json?: string;
}

function extractUrls(body: { data?: RawImageItem[] }): string[] {
  const out: string[] = [];
  for (const item of body.data ?? []) {
    if (item.url) {
      out.push(item.url);
    } else if (item.b64_json) {
      out.push(`data:image/png;base64,${item.b64_json}`);
    }
  }
  return out;
}

export interface ImagesResult {
  urls: string[];
}

export async function openaiGenerateImage(
  spaceId: string,
  opts: { prompt: string; size?: string; model?: string; n?: number },
): Promise<ImagesResult> {
  if (opts.n !== undefined && opts.n > MAX_N) {
    throw new Error(`OpenAI generateImage: n=${opts.n} exceeds max of ${MAX_N}.`);
  }
  const n = Math.max(1, opts.n ?? 1);

  const key = await getOpenAIKey(spaceId);
  const res = await fetch(`${OPENAI_API}/images/generations`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: opts.model ?? 'gpt-image-1',
      prompt: opts.prompt,
      size: opts.size ?? '1024x1024',
      n,
    }),
  });

  const body = (await readOrThrow(res, 'generateImage')) as { data?: RawImageItem[] };
  return { urls: extractUrls(body) };
}

export async function openaiEditImage(
  spaceId: string,
  opts: { prompt: string; imageUrl: string; maskUrl?: string },
): Promise<ImagesResult> {
  const key = await getOpenAIKey(spaceId);

  const imgRes = await fetch(opts.imageUrl);
  if (!imgRes.ok) {
    throw new Error(`OpenAI editImage: failed to fetch image ${opts.imageUrl}: ${imgRes.status}`);
  }
  const imgBlob = await imgRes.blob();

  const form = new FormData();
  form.append('prompt', opts.prompt);
  form.append('model', 'gpt-image-1');
  form.append('image', imgBlob, 'image.png');

  if (opts.maskUrl) {
    const maskRes = await fetch(opts.maskUrl);
    if (!maskRes.ok) {
      throw new Error(`OpenAI editImage: failed to fetch mask ${opts.maskUrl}: ${maskRes.status}`);
    }
    const maskBlob = await maskRes.blob();
    form.append('mask', maskBlob, 'mask.png');
  }

  const res = await fetch(`${OPENAI_API}/images/edits`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });

  const body = (await readOrThrow(res, 'editImage')) as { data?: RawImageItem[] };
  return { urls: extractUrls(body) };
}
