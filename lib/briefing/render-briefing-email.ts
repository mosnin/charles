/**
 * Daily founder briefing — email renderer.
 *
 * Takes a `DailyBriefingData` shape and produces the subject, HTML body,
 * and plain-text fallback. Pure function: no I/O, no env reads except a
 * single `NEXT_PUBLIC_APP_URL` lookup for the workspace CTA href.
 *
 * Voice rules (STYLESHEET.md): founder-first second person, no emojis,
 * no exclamation marks, sentence case in chrome, periods on microcopy,
 * Charles speaks in first person.
 */

import type { DailyBriefingData } from '@/lib/briefing/build-daily-briefing';

export interface BriefingEmail {
  subject: string;
  html: string;
  plainText: string;
}

/** Escape HTML — local copy so this module has no deps on lib/email.ts. */
function esc(value: string | null | undefined): string {
  if (!value) return '';
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

function appBaseUrl(): string {
  const raw = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.charles.dev';
  return raw.replace(/\/+$/, '');
}

/**
 * Greeting line. Uses first name if we have one; otherwise a plain
 * second-person opener that still feels addressed-to-you.
 */
function greeting(firstName: string | null): string {
  return firstName ? `Good morning, ${firstName}.` : 'Good morning.';
}

/**
 * Subject line. Per-day-content variation is achieved by including the
 * workspace name plus the date so threading doesn't collapse two briefings
 * from the same workspace on different days.
 */
function buildSubject(data: DailyBriefingData, dateLabel: string): string {
  if (data.isRestDay) {
    return `Quiet morning. Nothing on your plate. ${dateLabel}`;
  }
  const name = data.founderFirstName ?? 'Founder';
  return `${name}, here's where ${data.workspaceName} stands. ${dateLabel}`;
}

/** Short ISO-date label appended to subjects for daily uniqueness. */
function dateLabel(now: Date = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

const STYLES = {
  body: 'margin:0;padding:0;background:#fafafa;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text",system-ui,"Helvetica Neue",Arial,sans-serif;color:#0a0a0a;',
  wrap: 'max-width:600px;margin:0 auto;padding:40px 24px;',
  card: 'background:#ffffff;border:1px solid #e4e4e7;border-radius:12px;padding:40px 32px;',
  h1: 'font-size:28px;line-height:34px;font-weight:600;letter-spacing:-0.01em;margin:0 0 16px 0;color:#0a0a0a;',
  lead: 'font-size:16px;line-height:24px;font-weight:400;margin:0 0 24px 0;color:#27272a;',
  section: 'font-size:12px;line-height:16px;font-weight:500;text-transform:none;color:#71717a;margin:32px 0 8px 0;',
  ul: 'list-style:none;padding:0;margin:0 0 8px 0;',
  li: 'font-size:16px;line-height:24px;font-weight:400;color:#0a0a0a;padding:8px 0;border-bottom:1px solid #f4f4f5;',
  cta: 'display:inline-block;background:#0A0A0F;color:#ffffff;text-decoration:none;font-size:14px;line-height:20px;font-weight:500;padding:12px 20px;border-radius:8px;margin-top:24px;',
  footer: 'font-size:12px;line-height:16px;color:#71717a;margin-top:32px;',
};

function renderListHtml(items: string[]): string {
  if (items.length === 0) {
    return `<p style="${STYLES.lead};color:#71717a;margin:0 0 8px 0;">Nothing here.</p>`;
  }
  const lis = items.map((s) => `<li style="${STYLES.li}">${esc(s)}</li>`).join('');
  return `<ul style="${STYLES.ul}">${lis}</ul>`;
}

function renderRestDayHtml(data: DailyBriefingData, ctaUrl: string): string {
  const lead =
    'Nothing happened yesterday that I need to flag. Nothing is waiting on you. Use the hour for the work only you can do.';
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="${STYLES.body}">
  <div style="${STYLES.wrap}">
    <div style="${STYLES.card}">
      <h1 style="${STYLES.h1}">${esc(greeting(data.founderFirstName))}</h1>
      <p style="${STYLES.lead}">${esc(lead)}</p>
      <a href="${esc(ctaUrl)}" style="${STYLES.cta}">Open Charles</a>
      <p style="${STYLES.footer}">${esc(data.workspaceName)} &middot; stage: ${esc(data.currentStage)}</p>
    </div>
  </div>
</body></html>`;
}

function renderActiveHtml(data: DailyBriefingData, ctaUrl: string): string {
  const lead = `Here is where ${esc(data.workspaceName)} stands.`;
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="${STYLES.body}">
  <div style="${STYLES.wrap}">
    <div style="${STYLES.card}">
      <h1 style="${STYLES.h1}">${esc(greeting(data.founderFirstName))}</h1>
      <p style="${STYLES.lead}">${lead}</p>

      <p style="${STYLES.section}">Yesterday</p>
      ${renderListHtml(data.yesterdayHighlights)}

      <p style="${STYLES.section}">Today</p>
      ${renderListHtml(data.needsYouToday)}

      <a href="${esc(ctaUrl)}" style="${STYLES.cta}">Open Charles</a>

      <p style="${STYLES.footer}">${esc(data.workspaceName)} &middot; stage: ${esc(data.currentStage)}</p>
    </div>
  </div>
</body></html>`;
}

function renderRestDayText(data: DailyBriefingData, ctaUrl: string): string {
  const lines = [
    greeting(data.founderFirstName),
    '',
    'Nothing happened yesterday that I need to flag. Nothing is waiting on you. Use the hour for the work only you can do.',
    '',
    `Open Charles: ${ctaUrl}`,
    '',
    `${data.workspaceName} — stage: ${data.currentStage}`,
  ];
  return lines.join('\n');
}

function renderActiveText(data: DailyBriefingData, ctaUrl: string): string {
  const lines: string[] = [
    greeting(data.founderFirstName),
    '',
    `Here is where ${data.workspaceName} stands.`,
    '',
    'Yesterday',
  ];
  if (data.yesterdayHighlights.length === 0) {
    lines.push('  Nothing here.');
  } else {
    for (const h of data.yesterdayHighlights) lines.push(`  - ${h}`);
  }
  lines.push('', 'Today');
  if (data.needsYouToday.length === 0) {
    lines.push('  Nothing here.');
  } else {
    for (const a of data.needsYouToday) lines.push(`  - ${a}`);
  }
  lines.push('', `Open Charles: ${ctaUrl}`, '', `${data.workspaceName} — stage: ${data.currentStage}`);
  return lines.join('\n');
}

export function renderDailyBriefing(
  data: DailyBriefingData,
  workspaceSlug?: string,
  now: Date = new Date(),
): BriefingEmail {
  const base = appBaseUrl();
  const ctaUrl = workspaceSlug ? `${base}/s/${workspaceSlug}` : base;
  const subject = buildSubject(data, dateLabel(now));
  const html = data.isRestDay
    ? renderRestDayHtml(data, ctaUrl)
    : renderActiveHtml(data, ctaUrl);
  const plainText = data.isRestDay
    ? renderRestDayText(data, ctaUrl)
    : renderActiveText(data, ctaUrl);
  return { subject, html, plainText };
}

export const _internals = { buildSubject, dateLabel, greeting };
