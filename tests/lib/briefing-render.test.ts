/**
 * Unit tests for `renderDailyBriefing`. Pure function — no mocks needed,
 * only env stubbing for the CTA URL.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderDailyBriefing } from '@/lib/briefing/render-briefing-email';
import type { DailyBriefingData } from '@/lib/briefing/build-daily-briefing';

const NOW = new Date('2026-05-13T10:00:00Z');

function active(overrides: Partial<DailyBriefingData> = {}): DailyBriefingData {
  return {
    founderFirstName: 'Jane',
    workspaceName: 'Acme',
    yesterdayHighlights: ['Engineering completed 2 runs.', 'You approved 1 draft.'],
    needsYouToday: [
      { label: 'Approve 3 drafts waiting for you.', href: '/s/acme/chat/approvals' },
    ],
    comingUp: [],
    pendingApprovalsCount: 3,
    openTasksCount: 0,
    currentStage: 'building',
    isRestDay: false,
    ...overrides,
  };
}

function restDay(): DailyBriefingData {
  return {
    founderFirstName: 'Jane',
    workspaceName: 'Acme',
    yesterdayHighlights: [],
    needsYouToday: [],
    comingUp: [],
    pendingApprovalsCount: 0,
    openTasksCount: 0,
    currentStage: 'building',
    isRestDay: true,
  };
}

const savedAppUrl = process.env.NEXT_PUBLIC_APP_URL;
beforeEach(() => {
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.charles.dev';
});
afterEach(() => {
  if (savedAppUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
  else process.env.NEXT_PUBLIC_APP_URL = savedAppUrl;
});

const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

describe('renderDailyBriefing — subject', () => {
  it('uses first-name + workspace pattern for active days', () => {
    const out = renderDailyBriefing(active(), 'acme', NOW);
    expect(out.subject).toMatch(/^Jane, here's where Acme stands\. 2026-05-13$/);
  });

  it('falls back to "Founder" when no first name', () => {
    const out = renderDailyBriefing(active({ founderFirstName: null }), 'acme', NOW);
    expect(out.subject).toMatch(/^Founder, here's where Acme stands\. /);
  });

  it('rest-day subject is its own copy', () => {
    const out = renderDailyBriefing(restDay(), 'acme', NOW);
    expect(out.subject).toMatch(/^Quiet morning\. Nothing on your plate\. 2026-05-13$/);
  });

  it('subject differs day to day for the same workspace (threading guard)', () => {
    const day1 = renderDailyBriefing(active(), 'acme', new Date('2026-05-13T10:00:00Z'));
    const day2 = renderDailyBriefing(active(), 'acme', new Date('2026-05-14T10:00:00Z'));
    expect(day1.subject).not.toEqual(day2.subject);
  });
});

describe('renderDailyBriefing — HTML body', () => {
  it('includes the greeting and workspace name', () => {
    const out = renderDailyBriefing(active(), 'acme', NOW);
    expect(out.html).toContain('Good morning, Jane.');
    expect(out.html).toContain('Acme');
  });

  it('renders each highlight as a list item', () => {
    const data = active({
      yesterdayHighlights: ['Engineering completed 2 runs.', 'You approved 1 draft.'],
    });
    const out = renderDailyBriefing(data, 'acme', NOW);
    expect(out.html).toContain('Engineering completed 2 runs.');
    expect(out.html).toContain('You approved 1 draft.');
    // Both wrapped in <li>
    const liCount = (out.html.match(/<li/g) ?? []).length;
    expect(liCount).toBeGreaterThanOrEqual(2);
  });

  it('renders the Today action items', () => {
    const out = renderDailyBriefing(
      active({
        needsYouToday: [
          { label: 'Approve 3 drafts waiting for you.', href: '/s/acme/chat/approvals' },
        ],
      }),
      'acme',
      NOW,
    );
    expect(out.html).toContain('Approve 3 drafts waiting for you.');
  });

  it('escapes HTML in workspace name to prevent injection', () => {
    const out = renderDailyBriefing(active({ workspaceName: '<script>x</script>' }), 'acme', NOW);
    expect(out.html).not.toContain('<script>x</script>');
    expect(out.html).toContain('&lt;script&gt;');
  });

  it('uses the workspace slug in the CTA URL', () => {
    const out = renderDailyBriefing(active(), 'acme', NOW);
    expect(out.html).toContain('https://app.charles.dev/s/acme');
  });

  it('rest-day HTML mentions the rest-day lead line', () => {
    const out = renderDailyBriefing(restDay(), 'acme', NOW);
    expect(out.html).toContain('Nothing happened yesterday');
  });

  it('never contains emojis', () => {
    const out = renderDailyBriefing(active(), 'acme', NOW);
    expect(EMOJI_RE.test(out.html)).toBe(false);
    expect(EMOJI_RE.test(out.subject)).toBe(false);

    const rest = renderDailyBriefing(restDay(), 'acme', NOW);
    expect(EMOJI_RE.test(rest.html)).toBe(false);
  });

  it('never contains exclamation marks in user-visible copy (voice rule)', () => {
    const out = renderDailyBriefing(active(), 'acme', NOW);
    // Strip the doctype + tags; only the rendered text content counts.
    const visible = out.html.replace(/<!doctype[^>]*>/i, '').replace(/<[^>]+>/g, '');
    expect(visible).not.toMatch(/!/);
    expect(out.plainText).not.toMatch(/!/);
    expect(out.subject).not.toMatch(/!/);
  });
});

describe('renderDailyBriefing — plain text', () => {
  it('mirrors the highlights and actions', () => {
    const out = renderDailyBriefing(active(), 'acme', NOW);
    expect(out.plainText).toContain('Engineering completed 2 runs.');
    expect(out.plainText).toContain('Approve 3 drafts waiting for you.');
    expect(out.plainText).toContain('Yesterday');
    expect(out.plainText).toContain('Today');
  });

  it('includes the CTA URL', () => {
    const out = renderDailyBriefing(active(), 'acme', NOW);
    expect(out.plainText).toContain('https://app.charles.dev/s/acme');
  });

  it('rest-day plain text is the rest-day copy', () => {
    const out = renderDailyBriefing(restDay(), 'acme', NOW);
    expect(out.plainText).toContain('Nothing happened yesterday');
  });
});
