/**
 * composeBriefingMessage — Charles speaking the briefing in the dock.
 *
 * The dock injects this as a synthetic first assistant message of the day.
 * No bullets, no exclamation marks, no emoji. Rest day collapses to one
 * sentence. These pins guard the voice, not the chrome.
 */
import { describe, it, expect } from 'vitest';
import { composeBriefingMessage } from '@/components/canvas/chat-dock';
import type { DailyBriefingData } from '@/lib/briefing/build-daily-briefing';

function makeBriefing(overrides: Partial<DailyBriefingData> = {}): DailyBriefingData {
  return {
    founderFirstName: 'Jane',
    workspaceName: 'Acme',
    yesterdayHighlights: [],
    needsYouToday: [],
    comingUp: [],
    pendingApprovalsCount: 0,
    openTasksCount: 0,
    currentStage: 'Pre-launch',
    isRestDay: false,
    ...overrides,
  };
}

describe('composeBriefingMessage', () => {
  it('rest day is exactly one sentence and names the first name', () => {
    const out = composeBriefingMessage(makeBriefing({ isRestDay: true }));
    expect(out).toBe(
      "Morning, Jane. Nothing's flagged. Use the hour for the work only you can do.",
    );
  });

  it('skips the first name when none is available', () => {
    const out = composeBriefingMessage(
      makeBriefing({ founderFirstName: null, isRestDay: true }),
    );
    expect(out?.startsWith('Morning.')).toBe(true);
  });

  it('voices yesterday + today as paragraphs, no bullets', () => {
    const out = composeBriefingMessage(
      makeBriefing({
        yesterdayHighlights: ['You approved 1 draft.', 'engineering completed 2 runs.'],
        needsYouToday: [
          { label: 'Approve 1 draft waiting for you.', href: '/s/x/chat/approvals' },
        ],
      }),
    );
    expect(out).toBeTruthy();
    if (!out) throw new Error('null');
    expect(out).toContain('Yesterday:');
    expect(out).toContain('Waiting for you:');
    expect(out).not.toMatch(/^[•\-*]/m);
    expect(out).not.toMatch(/!/);
  });

  it('puts each highlight on its own line so they do not read as a run-on', () => {
    const out = composeBriefingMessage(
      makeBriefing({
        yesterdayHighlights: [
          'You approved 1 draft.',
          'engineering completed 2 runs.',
          'design shipped the new dashboard.',
        ],
      }),
    );
    if (!out) throw new Error('null');
    expect(out).toContain('Yesterday:\nYou approved 1 draft.\nengineering completed 2 runs.\ndesign shipped the new dashboard.');
  });

  it('when nothing is interesting and nothing waits, invites instead of reporting', () => {
    const out = composeBriefingMessage(makeBriefing());
    expect(out).toContain("Nothing's queued for you");
    expect(out).toContain("Tell me what we're working on");
  });
});
