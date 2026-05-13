/**
 * OpenAI Images adapter tests — auth, generate happy path, n-cap, error
 * surfacing, and b64 → data URI normalization.
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
  openaiGenerateImage,
  openaiEditImage,
} from '@/lib/integrations/adapters/openai-images';

const fetchMock = vi.fn<typeof fetch>();
global.fetch = fetchMock as unknown as typeof fetch;

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const ORIG_KEY = process.env.OPENAI_API_KEY;

beforeEach(() => {
  fetchMock.mockReset();
  maybeSingleMock.mockReset();
  maybeSingleMock.mockResolvedValue({ data: null, error: null });
  delete process.env.OPENAI_API_KEY;
});

afterEach(() => {
  if (ORIG_KEY === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = ORIG_KEY;
});

describe('OpenAI Images adapter — auth resolution', () => {
  it('uses the IntegrationConnection accessToken when present', async () => {
    maybeSingleMock.mockResolvedValue({
      data: { accessToken: 'sk-db' },
      error: null,
    });
    fetchMock.mockResolvedValue(jsonRes({ data: [{ url: 'https://img/x.png' }] }));

    await openaiGenerateImage('space_1', { prompt: 'a cat' });

    const headers = (fetchMock.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer sk-db');
  });

  it('falls back to OPENAI_API_KEY env when no DB row', async () => {
    process.env.OPENAI_API_KEY = 'sk-env';
    fetchMock.mockResolvedValue(jsonRes({ data: [{ url: 'https://img/x.png' }] }));

    await openaiGenerateImage('space_1', { prompt: 'a cat' });

    const headers = (fetchMock.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer sk-env');
  });

  it('throws when neither DB row nor env var is set', async () => {
    await expect(
      openaiGenerateImage('space_1', { prompt: 'a cat' }),
    ).rejects.toThrow(/no API key/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('OpenAI Images adapter — generate happy paths', () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'sk-env';
  });

  it('returns urls from a multi-image response', async () => {
    fetchMock.mockResolvedValue(
      jsonRes({
        data: [
          { url: 'https://img/1.png' },
          { url: 'https://img/2.png' },
        ],
      }),
    );

    const r = await openaiGenerateImage('s', { prompt: 'two cats', n: 2 });
    expect(r).toEqual({ urls: ['https://img/1.png', 'https://img/2.png'] });

    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.n).toBe(2);
    expect(body.prompt).toBe('two cats');
    expect(body.model).toBe('gpt-image-1');
    expect(body.size).toBe('1024x1024');
  });

  it('normalizes b64_json responses into data: URIs', async () => {
    fetchMock.mockResolvedValue(
      jsonRes({ data: [{ b64_json: 'AAAA' }] }),
    );

    const r = await openaiGenerateImage('s', { prompt: 'cat' });
    expect(r.urls).toEqual(['data:image/png;base64,AAAA']);
  });

  it('forwards custom model and size', async () => {
    fetchMock.mockResolvedValue(jsonRes({ data: [{ url: 'https://img/x.png' }] }));

    await openaiGenerateImage('s', {
      prompt: 'cat',
      model: 'dall-e-3',
      size: '1792x1024',
    });

    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.model).toBe('dall-e-3');
    expect(body.size).toBe('1792x1024');
  });
});

describe('OpenAI Images adapter — n cap', () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'sk-env';
  });

  it('throws when n exceeds 4', async () => {
    await expect(
      openaiGenerateImage('s', { prompt: 'cat', n: 5 }),
    ).rejects.toThrow(/exceeds max of 4/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('accepts n=4 exactly', async () => {
    fetchMock.mockResolvedValue(jsonRes({ data: [{ url: 'https://img/x.png' }] }));
    await openaiGenerateImage('s', { prompt: 'cat', n: 4 });
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.n).toBe(4);
  });
});

describe('OpenAI Images adapter — error handling', () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'sk-env';
  });

  it('surfaces server error message on non-2xx', async () => {
    fetchMock.mockResolvedValue(
      jsonRes({ error: { message: 'Billing hard limit reached' } }, 429),
    );
    await expect(openaiGenerateImage('s', { prompt: 'cat' })).rejects.toThrow(
      /429.*Billing hard limit reached/,
    );
  });
});

describe('OpenAI Images adapter — edit', () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'sk-env';
  });

  it('fetches the source image then posts an edit, returning urls', async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { 'Content-Type': 'image/png' },
        }),
      )
      .mockResolvedValueOnce(jsonRes({ data: [{ url: 'https://img/edited.png' }] }));

    const r = await openaiEditImage('s', {
      prompt: 'add a hat',
      imageUrl: 'https://src/img.png',
    });

    expect(r).toEqual({ urls: ['https://img/edited.png'] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]![0]).toBe('https://src/img.png');
    const editUrl = fetchMock.mock.calls[1]![0] as string;
    expect(editUrl).toContain('/images/edits');
  });
});
