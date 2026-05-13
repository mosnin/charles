/**
 * Thin Replicate REST API adapter — image / video generation only.
 *
 * Replicate predictions are async. We start the prediction and poll its
 * status up to a short ceiling (60s images, 120s video). If it isn't
 * terminal by then, the caller gets {status: 'starting' | 'processing'}
 * and the prediction id so the founder can poll again later.
 *
 * Auth: IntegrationConnection (toolkit='replicate', status='active') →
 * REPLICATE_API_TOKEN env. Throws when neither is set.
 */

import { supabase } from '@/lib/supabase';

const REPLICATE_API = 'https://api.replicate.com/v1';
const POLL_INTERVAL_MS = 2000;
const MAX_WAIT_IMAGE_MS = 60_000;
const MAX_WAIT_VIDEO_MS = 120_000;

async function getReplicateToken(spaceId: string): Promise<string> {
  const { data } = await supabase
    .from('IntegrationConnection')
    .select('accessToken')
    .eq('spaceId', spaceId)
    .eq('toolkit', 'replicate')
    .eq('status', 'active')
    .maybeSingle();

  const token = (data as { accessToken?: string } | null)?.accessToken;
  if (token) return token;

  const env = process.env.REPLICATE_API_TOKEN;
  if (env) return env;

  throw new Error(
    `Replicate: no API token found for space ${spaceId}. ` +
      `Connect Replicate in Settings → Integrations, or set REPLICATE_API_TOKEN.`,
  );
}

function headers(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

async function readOrThrow(res: Response, action: string): Promise<unknown> {
  if (!res.ok) {
    let body: { detail?: string; error?: string } = {};
    try {
      body = (await res.json()) as { detail?: string; error?: string };
    } catch {
      // ignore
    }
    const msg = body.detail ?? body.error ?? (await res.text().catch(() => ''));
    throw new Error(`Replicate ${action} failed: ${res.status} — ${msg}`);
  }
  return res.json();
}

export interface PredictionResult {
  predictionId: string;
  status: string;
  output: string | string[] | null;
}

interface RawPrediction {
  id?: string;
  status?: string;
  output?: string | string[] | null;
  error?: string | null;
}

function shapeResult(raw: RawPrediction): PredictionResult {
  return {
    predictionId: raw.id ?? '',
    status: raw.status ?? 'unknown',
    output: raw.output ?? null,
  };
}

async function pollPrediction(
  token: string,
  predictionId: string,
  maxWaitMs: number,
): Promise<RawPrediction> {
  const start = Date.now();
  let latest: RawPrediction = { id: predictionId, status: 'starting', output: null };
  while (Date.now() - start < maxWaitMs) {
    const res = await fetch(`${REPLICATE_API}/predictions/${predictionId}`, {
      headers: headers(token),
    });
    if (!res.ok) {
      throw new Error(`Replicate poll failed: ${res.status}`);
    }
    latest = (await res.json()) as RawPrediction;
    if (
      latest.status === 'succeeded' ||
      latest.status === 'failed' ||
      latest.status === 'canceled'
    ) {
      return latest;
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  return latest;
}

async function runPrediction(
  token: string,
  model: string,
  input: Record<string, unknown>,
  maxWaitMs: number,
): Promise<PredictionResult> {
  const res = await fetch(`${REPLICATE_API}/models/${model}/predictions`, {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify({ input }),
  });
  const created = (await readOrThrow(res, 'createPrediction')) as RawPrediction;

  const terminal = new Set(['succeeded', 'failed', 'canceled']);
  if (created.status && terminal.has(created.status)) {
    return shapeResult(created);
  }

  const final = await pollPrediction(token, created.id ?? '', maxWaitMs);
  return shapeResult(final);
}

export async function replicateGenerateImage(
  spaceId: string,
  opts: { prompt: string; model?: string; aspectRatio?: string },
): Promise<PredictionResult> {
  const token = await getReplicateToken(spaceId);
  return runPrediction(
    token,
    opts.model ?? 'black-forest-labs/flux-schnell',
    { prompt: opts.prompt, aspect_ratio: opts.aspectRatio ?? '1:1' },
    MAX_WAIT_IMAGE_MS,
  );
}

export async function replicateGenerateVideo(
  spaceId: string,
  opts: { prompt: string; model?: string; durationSeconds?: number },
): Promise<PredictionResult> {
  const token = await getReplicateToken(spaceId);
  return runPrediction(
    token,
    opts.model ?? 'minimax/video-01',
    { prompt: opts.prompt, duration: opts.durationSeconds ?? 6 },
    MAX_WAIT_VIDEO_MS,
  );
}

export async function replicateGetPrediction(
  spaceId: string,
  predictionId: string,
): Promise<PredictionResult> {
  const token = await getReplicateToken(spaceId);
  const res = await fetch(`${REPLICATE_API}/predictions/${predictionId}`, {
    headers: headers(token),
  });
  const raw = (await readOrThrow(res, 'getPrediction')) as RawPrediction;
  return shapeResult(raw);
}
