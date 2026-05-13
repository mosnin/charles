/**
 * Email campaigns rollup — auth, provider parsing, overview math,
 * defensive isolation between providers.
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
  loadResendCampaigns,
  loadLoopsCampaigns,
  loadRecentCampaigns,
  loadCampaignsOverview,
  computeOverview,
  rollupResendEmails,
  rollupLoopsTemplates,
  type CampaignSummary,
} from '@/lib/email-campaigns/rollup';

const fetchMock = vi.fn<typeof fetch>();
global.fetch = fetchMock as unknown as typeof fetch;

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const ORIG_RESEND = process.env.RESEND_API_KEY;
const ORIG_LOOPS = process.env.LOOPS_API_KEY;

beforeEach(() => {
  fetchMock.mockReset();
  maybeSingleMock.mockReset();
  maybeSingleMock.mockResolvedValue({ data: null, error: null });
  delete process.env.RESEND_API_KEY;
  delete process.env.LOOPS_API_KEY;
});
afterEach(() => {
  if (ORIG_RESEND === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = ORIG_RESEND;
  if (ORIG_LOOPS === undefined) delete process.env.LOOPS_API_KEY;
  else process.env.LOOPS_API_KEY = ORIG_LOOPS;
});

// ── Auth ─────────────────────────────────────────────────────────────────────

describe('rollup — auth', () => {
  it('Resend: uses IntegrationConnection token when present', async () => {
    maybeSingleMock.mockResolvedValue({
      data: { accessToken: 're_db' },
      error: null,
    });
    fetchMock.mockResolvedValue(jsonRes({ data: [] }));
    await loadResendCampaigns('s1');
    const headers = (fetchMock.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer re_db');
  });

  it('Resend: falls back to RESEND_API_KEY env when no DB row', async () => {
    process.env.RESEND_API_KEY = 're_env';
    fetchMock.mockResolvedValue(jsonRes({ data: [] }));
    await loadResendCampaigns('s1');
    const headers = (fetchMock.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer re_env');
  });

  it('Resend: returns [] (no throw) when neither token nor env is set', async () => {
    const rows = await loadResendCampaigns('s1');
    expect(rows).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('Loops: uses IntegrationConnection token when present', async () => {
    maybeSingleMock.mockResolvedValue({
      data: { accessToken: 'lp_db' },
      error: null,
    });
    // Two fetches: /transactional then /events
    fetchMock.mockResolvedValueOnce(jsonRes([]));
    await loadLoopsCampaigns('s1');
    const headers = (fetchMock.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer lp_db');
  });

  it('Loops: falls back to LOOPS_API_KEY env when no DB row', async () => {
    process.env.LOOPS_API_KEY = 'lp_env';
    fetchMock.mockResolvedValueOnce(jsonRes([]));
    await loadLoopsCampaigns('s1');
    const headers = (fetchMock.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer lp_env');
  });

  it('Loops: returns [] (no throw) when neither token nor env is set', async () => {
    const rows = await loadLoopsCampaigns('s1');
    expect(rows).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ── Resend parsing ───────────────────────────────────────────────────────────

describe('rollup — Resend parsing', () => {
  it('groups emails by (subject, day) and counts events with downstream implication', () => {
    const rows = rollupResendEmails([
      {
        id: 'e1',
        subject: 'Welcome',
        created_at: '2026-05-01T10:00:00Z',
        last_event: 'delivered',
      },
      {
        id: 'e2',
        subject: 'Welcome',
        created_at: '2026-05-01T11:00:00Z',
        last_event: 'opened',
      },
      {
        id: 'e3',
        subject: 'Welcome',
        created_at: '2026-05-01T12:00:00Z',
        last_event: 'clicked',
      },
      {
        id: 'e4',
        subject: 'Welcome',
        created_at: '2026-05-01T13:00:00Z',
        last_event: 'bounced',
      },
      {
        id: 'e5',
        subject: 'Different day',
        created_at: '2026-05-02T09:00:00Z',
        last_event: 'delivered',
      },
    ]);

    const welcome = rows.find((r) => r.subject === 'Welcome');
    expect(welcome).toBeDefined();
    expect(welcome!.totalSent).toBe(4);
    expect(welcome!.delivered).toBe(3);
    expect(welcome!.opened).toBe(2);
    expect(welcome!.clicked).toBe(1);
    expect(welcome!.bounced).toBe(1);
    expect(welcome!.provider).toBe('resend');
    expect(welcome!.sentAt).toBe('2026-05-01T10:00:00Z');

    const other = rows.find((r) => r.subject === 'Different day');
    expect(other!.totalSent).toBe(1);
    expect(other!.delivered).toBe(1);
  });

  it('groups same subject on different days separately', () => {
    const rows = rollupResendEmails([
      { id: '1', subject: 'Daily', created_at: '2026-05-01T10:00:00Z', last_event: 'delivered' },
      { id: '2', subject: 'Daily', created_at: '2026-05-02T10:00:00Z', last_event: 'delivered' },
    ]);
    expect(rows).toHaveLength(2);
  });

  it('handles missing subject as "(no subject)"', () => {
    const rows = rollupResendEmails([
      { id: '1', created_at: '2026-05-01T10:00:00Z', last_event: 'delivered' },
    ]);
    expect(rows[0]!.subject).toBe('(no subject)');
  });

  it('counts complained as unsubscribed', () => {
    const rows = rollupResendEmails([
      { id: '1', subject: 'X', created_at: '2026-05-01T10:00:00Z', last_event: 'complained' },
    ]);
    expect(rows[0]!.unsubscribed).toBe(1);
  });

  it('loadResendCampaigns: happy-path hits /emails with bearer + date_from', async () => {
    process.env.RESEND_API_KEY = 're_test';
    fetchMock.mockResolvedValue(
      jsonRes({
        data: [
          { id: 'e1', subject: 'Hi', created_at: '2026-05-01T10:00:00Z', last_event: 'opened' },
        ],
      }),
    );
    const rows = await loadResendCampaigns('s', { days: 7 });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.subject).toBe('Hi');
    expect(rows[0]!.opened).toBe(1);
    const url = String(fetchMock.mock.calls[0]![0]);
    expect(url).toContain('api.resend.com/emails');
    expect(url).toContain('date_from=');
  });

  it('loadResendCampaigns: returns [] on non-2xx response', async () => {
    process.env.RESEND_API_KEY = 're_test';
    fetchMock.mockResolvedValue(jsonRes({ message: 'unauthorized' }, 401));
    const rows = await loadResendCampaigns('s');
    expect(rows).toEqual([]);
  });

  it('loadResendCampaigns: returns [] on fetch throw', async () => {
    process.env.RESEND_API_KEY = 're_test';
    fetchMock.mockRejectedValue(new Error('network'));
    const rows = await loadResendCampaigns('s');
    expect(rows).toEqual([]);
  });
});

// ── Loops parsing ────────────────────────────────────────────────────────────

describe('rollup — Loops parsing', () => {
  it('counts sent-events per template, leaves open/click at 0 (API does not expose them)', () => {
    const now = Date.now();
    const rows = rollupLoopsTemplates(
      [
        { id: 'tx_1', name: 'Welcome', subject: 'Welcome aboard' },
        { id: 'tx_2', name: 'Receipt' },
      ],
      [
        { transactionalId: 'tx_1', timestamp: now - 1000 },
        { transactionalId: 'tx_1', timestamp: now - 2000 },
        { transactionalId: 'tx_2', timestamp: now - 500 },
      ],
      now - 86_400_000,
    );

    const welcome = rows.find((r) => r.id === 'tx_1')!;
    expect(welcome.totalSent).toBe(2);
    expect(welcome.opened).toBe(0);
    expect(welcome.clicked).toBe(0);
    expect(welcome.bounced).toBe(0);
    expect(welcome.subject).toBe('Welcome aboard');
    expect(welcome.provider).toBe('loops');

    const receipt = rows.find((r) => r.id === 'tx_2')!;
    expect(receipt.totalSent).toBe(1);
    expect(receipt.subject).toBe('Receipt'); // falls back to name
  });

  it('skips events older than sinceMs', () => {
    const now = Date.now();
    const rows = rollupLoopsTemplates(
      [{ id: 'tx_1', name: 'X' }],
      [
        { transactionalId: 'tx_1', timestamp: now - 1000 },
        { transactionalId: 'tx_1', timestamp: now - 10 * 86_400_000 },
      ],
      now - 86_400_000,
    );
    expect(rows[0]!.totalSent).toBe(1);
  });

  it('includes templates with zero sends so users can see configured templates', () => {
    const rows = rollupLoopsTemplates(
      [{ id: 'tx_quiet', name: 'Quiet' }],
      [],
      Date.now() - 86_400_000,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.totalSent).toBe(0);
  });

  it('loadLoopsCampaigns: happy path with templates + events', async () => {
    process.env.LOOPS_API_KEY = 'lp_test';
    fetchMock
      .mockResolvedValueOnce(jsonRes([{ id: 'tx_1', name: 'Welcome' }]))
      .mockResolvedValueOnce(
        jsonRes([{ transactionalId: 'tx_1', timestamp: Date.now() }]),
      );
    const rows = await loadLoopsCampaigns('s');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.totalSent).toBe(1);
    expect(rows[0]!.provider).toBe('loops');
  });

  it('loadLoopsCampaigns: returns [] when /transactional fails', async () => {
    process.env.LOOPS_API_KEY = 'lp_test';
    fetchMock.mockResolvedValue(jsonRes({ message: 'denied' }, 401));
    const rows = await loadLoopsCampaigns('s');
    expect(rows).toEqual([]);
  });

  it('loadLoopsCampaigns: still returns templates when /events endpoint fails', async () => {
    process.env.LOOPS_API_KEY = 'lp_test';
    fetchMock
      .mockResolvedValueOnce(jsonRes([{ id: 'tx_1', name: 'W' }]))
      .mockResolvedValueOnce(jsonRes({ message: 'not found' }, 404));
    const rows = await loadLoopsCampaigns('s');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.totalSent).toBe(0);
  });
});

// ── Overview math ────────────────────────────────────────────────────────────

describe('rollup — overview math', () => {
  it('computes rates as counts / totalSent', () => {
    const rows: CampaignSummary[] = [
      {
        provider: 'resend',
        id: '1',
        subject: 'A',
        sentAt: '2026-05-01T00:00:00Z',
        totalSent: 100,
        delivered: 95,
        opened: 50,
        clicked: 10,
        bounced: 5,
        unsubscribed: 0,
      },
      {
        provider: 'resend',
        id: '2',
        subject: 'B',
        sentAt: '2026-05-02T00:00:00Z',
        totalSent: 100,
        delivered: 90,
        opened: 30,
        clicked: 5,
        bounced: 10,
        unsubscribed: 0,
      },
    ];
    const o = computeOverview(rows);
    expect(o.totalSent30d).toBe(200);
    expect(o.deliveredRate).toBeCloseTo(0.925);
    expect(o.openRate).toBeCloseTo(0.4);
    expect(o.clickRate).toBeCloseTo(0.075);
    expect(o.bounceRate).toBeCloseTo(0.075);
  });

  it('returns zero rates when nothing sent (no division by zero)', () => {
    const o = computeOverview([]);
    expect(o.totalSent30d).toBe(0);
    expect(o.openRate).toBe(0);
    expect(o.clickRate).toBe(0);
    expect(o.deliveredRate).toBe(0);
    expect(o.bounceRate).toBe(0);
  });

  it('loadCampaignsOverview combines both providers', async () => {
    process.env.RESEND_API_KEY = 're_t';
    process.env.LOOPS_API_KEY = 'lp_t';
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('resend.com/emails')) {
        return jsonRes({
          data: [
            { id: 'e1', subject: 'X', created_at: '2026-05-01T00:00:00Z', last_event: 'opened' },
          ],
        });
      }
      if (url.includes('/transactional')) return jsonRes([{ id: 'tx_1', name: 'T' }]);
      if (url.includes('/events')) {
        return jsonRes([{ transactionalId: 'tx_1', timestamp: Date.now() }]);
      }
      return jsonRes({}, 404);
    });
    const o = await loadCampaignsOverview('s');
    // Resend: 1 sent, 1 opened. Loops: 1 sent, 0 opened. Combined: 2 sent, 1 opened.
    expect(o.totalSent30d).toBe(2);
    expect(o.openRate).toBeCloseTo(0.5);
  });
});

// ── Merged feed ──────────────────────────────────────────────────────────────

describe('rollup — loadRecentCampaigns', () => {
  it('merges Resend + Loops and sorts by sentAt desc', async () => {
    process.env.RESEND_API_KEY = 're_t';
    process.env.LOOPS_API_KEY = 'lp_t';
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('resend.com/emails')) {
        return jsonRes({
          data: [
            { id: 'e1', subject: 'Old', created_at: '2026-04-01T00:00:00Z', last_event: 'opened' },
            { id: 'e2', subject: 'New', created_at: '2026-05-05T00:00:00Z', last_event: 'opened' },
          ],
        });
      }
      if (url.endsWith('/transactional')) {
        return jsonRes([{ id: 'tx_1', name: 'Mid' }]);
      }
      if (url.includes('/events')) {
        // Loops timestamp roughly between the two Resend dates
        return jsonRes([
          {
            transactionalId: 'tx_1',
            timestamp: Date.parse('2026-04-20T00:00:00Z'),
          },
        ]);
      }
      return jsonRes({}, 404);
    });
    const rows = await loadRecentCampaigns('s');
    expect(rows).toHaveLength(3);
    expect(rows[0]!.subject).toBe('New');
    expect(rows[2]!.subject).toBe('Old');
  });

  it('one provider throwing does not break the other', async () => {
    process.env.RESEND_API_KEY = 're_t';
    process.env.LOOPS_API_KEY = 'lp_t';
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('resend.com/emails')) {
        throw new Error('resend exploded');
      }
      if (url.endsWith('/transactional')) {
        return jsonRes([{ id: 'tx_1', name: 'Survives' }]);
      }
      if (url.includes('/events')) {
        return jsonRes([{ transactionalId: 'tx_1', timestamp: Date.now() }]);
      }
      return jsonRes({}, 404);
    });
    const rows = await loadRecentCampaigns('s');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.subject).toBe('Survives');
  });

  it('returns [] when both providers fail (no throw upward)', async () => {
    // No env, no DB → both loaders short-circuit to []
    const rows = await loadRecentCampaigns('s');
    expect(rows).toEqual([]);
  });
});
