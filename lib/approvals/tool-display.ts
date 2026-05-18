/**
 * Tool-name → display mapping for the Approval Command Center.
 *
 * When Charles pauses for approval, the persisted task metadata carries only
 * a tool name (e.g. `send_email`, `github_open_pr`). The founder needs to
 * read it in plain English in a moment of decision. This module is the one
 * source of truth on the TS side for how each tool name reads.
 *
 * Pairs with `agent/orchestrator.py:_HIGH_RISK_PATTERNS` — those are the
 * Python-side rules that decide whether a tool pauses for approval at all.
 * This file is what the founder sees when it does. The two are intentionally
 * separate concerns: pause-or-not vs. how-to-render.
 *
 * Adding a new department tool? Add a line to TOOL_LABELS so it doesn't
 * fall through to the auto-humaniser. If it's reversible / no-blast-radius,
 * add it to LOW_RISK_TOOLS. When unsure: leave it out — the default is
 * high risk, which is the safer reading.
 */

export type ApprovalRisk = 'high' | 'low';

export interface ToolDisplay {
  /** Human label shown on the approval card. Sentence case, action voice. */
  label: string;
  risk: ApprovalRisk;
}

/**
 * Explicit labels for every tool Charles is wired to call.
 * Coverage: engineering (GitHub / Cloudflare / Vercel / Supabase), marketing
 * (LinkedIn / Twitter / Loops), design (Replicate / OpenAI images), comms
 * (send_email / send_sms), and the realtor-era verbs that survived only
 * because the chat permission prompt still handles them.
 */
const TOOL_LABELS: Record<string, string> = {
  // Comms
  send_email: 'Send email',
  send_sms: 'Send SMS',

  // Engineering — GitHub
  github_create_file: 'Commit a file to GitHub',
  github_create_repo: 'Create a GitHub repo',
  github_open_pr: 'Open a pull request',

  // Engineering — Cloudflare
  cloudflare_create_record: 'Create a DNS record',
  cloudflare_update_record: 'Update a DNS record',
  cloudflare_delete_record: 'Delete a DNS record',
  cloudflare_register_domain: 'Register a domain',

  // Engineering — Vercel
  vercel_trigger_deployment: 'Trigger a Vercel deployment',
  vercel_set_env_vars: 'Set Vercel environment variables',

  // Engineering — Supabase
  supabase_stage_migration: 'Stage a Supabase migration',

  // Marketing
  linkedin_post: 'Post to LinkedIn',
  twitter_post: 'Post to Twitter',
  loops_send_event: 'Fire a Loops event',
  loops_send_transactional: 'Send a transactional email',

  // Design
  replicate_generate_image: 'Generate an image with Replicate',
  replicate_generate_video: 'Generate a video with Replicate',
  openai_generate_image: 'Generate an image with OpenAI',
  openai_edit_image: 'Edit an image with OpenAI',

  // Realtor-era survivors still mapped by approval-celebration.tsx.
  // Harmless to keep until the celebration union is reshaped.
  note_on_person: 'Add a note to a person',
  note_on_deal: 'Add a note to a deal',
  log_email_sent: 'Log a sent email',
  log_sms_sent: 'Log a sent SMS',
  log_call: 'Log a call',
  log_meeting: 'Log a meeting',
  move_deal_stage: 'Move a deal stage',
  schedule_tour: 'Schedule a tour',
  reschedule_tour: 'Reschedule a tour',
  mark_person_hot: 'Mark a person hot',
  mark_person_cold: 'Mark a person cold',
  set_followup: 'Set a follow-up',
};

/**
 * Tools whose blast radius is small enough that a paused-for-approval state
 * doesn't need the high-risk weight. Right now: image generation only — it
 * costs a few cents and produces a file, but doesn't talk to customers or
 * mutate infra. Everything else defaults to high.
 */
const LOW_RISK_TOOLS: ReadonlySet<string> = new Set([
  'replicate_generate_image',
  'replicate_generate_video',
  'openai_generate_image',
  'openai_edit_image',
  'note_on_person',
  'note_on_deal',
  'log_email_sent',
  'log_sms_sent',
  'log_call',
  'log_meeting',
  'mark_person_hot',
  'mark_person_cold',
  'set_followup',
]);

/** Snake_case → Title Case Phrase. The fallback so an unmapped tool name
 *  still reads like English instead of a debug string. */
function humanize(toolName: string): string {
  return toolName
    .split('_')
    .filter((w) => w.length > 0)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');
}

export function getToolDisplay(toolName: string): ToolDisplay {
  return {
    label: TOOL_LABELS[toolName] ?? humanize(toolName),
    risk: LOW_RISK_TOOLS.has(toolName) ? 'low' : 'high',
  };
}

/** Internal helpers, exported for tests. */
export const _internals = { humanize, TOOL_LABELS, LOW_RISK_TOOLS };
