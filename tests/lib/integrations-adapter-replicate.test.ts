/**
 * Replicate adapter tests — auth resolution, generate happy path, polling
 * termination, and prediction read-back.
 *
 * Polling intervals are real but we never wait past the first poll in
 * tests — we make the create response terminal, or the first poll terminal.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { maybeSingleMock } = vi.hoisted(() => ({
  maybeSingleMock: vi.fn<() => Promise<{ data: unknown; error: null }>>(),
}));

vi.mock('@/lib/supabase', () => {
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    maybeSingle: maybeSingleMock,
  };
  return { supabase: { from: vi.fn(() => chain) } };
});

import {
  replicateGenerateImage,
  replicateGenerateVideo,
  replicateGetPrediction,
} from '@/lib/integrations/adapters/replicate';

const fetchMock = vi.fn<typeof fetch>();
global.fetch = fetchMock as unknown as typeof fetch;

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const ORIG_TOKEN = process.env.REPLICATE_API_TOKEN;

beforeEach(() => {
  fetchMock.mockReset();
  maybeSingleMock.mockReset();
  maybeSingleMock.mockResolvedValue({ data: null, error: null });
  delete process.env.REPLICATE_API_TOKEN;
});

afterEach(() => {
  if (ORIG_TOKEN === undefined) delete process.env.REPLICATE_API_TOKEN;
  else process.env.REPLICATE_API_TOKEN = ORIG_TOKEN;
});

describe('Replicate adapter — auth resolution', () => {
  it('uses the IntegrationConnection accessToken when present', async () => {
    maybeSingleMock.mockResolvedValue({
      data: { accessToken: 'r8_db_token' },
      error: null,
    });
    fetchMock.mockResolvedValue(
      jsonRes({ id: 'pred_1', status: 'succeeded', output: 'https://img/x.png' }),
    );

    await replicateGenerateImage('space_1', { prompt: 'a cat' });

    const headers = (fetchMock.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer r8_db_token');
  });

  it('falls back to REPLICATE_API_TOKEN env when no DB row', async () => {
    process.env.REPLICATE_API_TOKEN = 'r8_env';
    fetchMock.mockResolvedValue(
      jsonRes({ id: 'pred_1', status: 'succeeded', output: 'https://img/x.png' }),
    );

    await replicateGenerateImage('space_1', { prompt: 'a cat' });

    const headers = (fetchMock.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer r8_env');
  });

  it('throws when neither DB row nor env var is set', async () => {
    await expect(
      replicateGenerateImage('space_1', { prompt: 'a cat' }),
    ).rejects.toThrow(/no API token/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('Replicate adapter — generate happy paths', () => {
  beforeEach(() => {
    process.env.REPLICATE_API_TOKEN = 'r8_env';
  });

  it('generateImage returns predictionId + status + output when terminal on create', async () => {
    fetchMock.mockResolvedValue(
      jsonRes({
        id: 'pred_abc',
        status: 'succeeded',
        output: ['https://img/1.png'],
      }),
    );

    const r = await replicateGenerateImage('s', { prompt: 'a cat', aspectRatio: '16:9' });

    expect(r).toEqual({
      predictionId: 'pred_abc',
      status: 'succeeded',
      output: ['https://img/1.png'],
    });
    const url = fetchMock.mock.calls[0]![0] as string;
    expect(url).toContain('/models/black-forest-labs/flux-schnell/predictions');
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.input.aspect_ratio).toBe('16:9');
  });

  it('generateImage normalizes string output (model returns single URL)', async () => {
    fetchMock.mockResolvedValue(
      jsonRes({
        id: 'pred_xyz',
        status: 'succeeded',
        output: 'https://img/only.png',
      }),
    );

    const r = await replicateGenerateImage('s', { prompt: 'a cat' });
    expect(r.output).toBe('https://img/only.png');
  });

  it('generateVideo posts to the video model with duration input', async () => {
    fetchMock.mockResolvedValue(
      jsonRes({
        id: 'pred_v',
        status: 'succeeded',
        output: 'https://vid/x.mp4',
      }),
    );

    const r = await replicateGenerateVideo('s', { prompt: 'a sunset', durationSeconds: 8 });
    expect(r.output).toBe('https://vid/x.mp4');
    const url = fetchMock.mock.calls[0]![0] as string;
    expect(url).toContain('/models/minimax/video-01/predictions');
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.input.duration).toBe(8);
  });
});

describe('Replicate adapter — polling', () => {
  beforeEach(() => {
    process.env.REPLICATE_API_TOKEN = 'r8_env';
  });

  it('polls until status=succeeded', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonRes({ id: 'pred_p', status: 'starting' }))
      .mockResolvedValueOnce(
        jsonRes({ id: 'pred_p', status: 'succeeded', output: 'https://img/p.png' }),
      );

    const r = await replicateGenerateImage('s', { prompt: 'a cat' });
    expect(r.status).toBe('succeeded');
    expect(r.output).toBe('https://img/p.png');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('polls until status=failed and surfaces it', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonRes({ id: 'pred_f', status: 'processing' }))
      .mockResolvedValueOnce(
        jsonRes({ id: 'pred_f', status: 'failed', output: null, error: 'OOM' }),
      );

    const r = await replicateGenerateImage('s', { prompt: 'a cat' });
    expect(r.status).toBe('failed');
    expect(r.output).toBeNull();
  });
});

describe('Replicate adapter — getPrediction', () => {
  beforeEach(() => {
    process.env.REPLICATE_API_TOKEN = 'r8_env';
  });

  it('returns the parsed prediction body', async () => {
    fetchMock.mockResolvedValue(
      jsonRes({ id: 'pred_g', status: 'succeeded', output: 'https://img/g.png' }),
    );
    const r = await replicateGetPrediction('s', 'pred_g');
    expect(r).toEqual({
      predictionId: 'pred_g',
      status: 'succeeded',
      output: 'https://img/g.png',
    });
    expect(fetchMock.mock.calls[0]![0]).toContain('/predictions/pred_g');
  });

  it('throws with status + detail on non-2xx', async () => {
    fetchMock.mockResolvedValue(jsonRes({ detail: 'Authentication failed' }, 401));
    await expect(replicateGetPrediction('s', 'pred_x')).rejects.toThrow(
      /401.*Authentication failed/,
    );
  });
});
