/**
 * The approval command center reads from this mapping in a moment of
 * decision. These tests pin the labels the founder actually sees (taste
 * decisions worth not accidentally regressing) and the fallback contract:
 * an unknown tool reads in English and defaults to high risk.
 */
import { describe, it, expect } from 'vitest';
import { getToolDisplay, _internals } from '@/lib/approvals/tool-display';

describe('getToolDisplay — explicit labels', () => {
  it('renders comms tools in plain English', () => {
    expect(getToolDisplay('send_email').label).toBe('Send email');
    expect(getToolDisplay('send_sms').label).toBe('Send SMS');
  });

  it('renders engineering tools with provider names', () => {
    expect(getToolDisplay('github_open_pr').label).toBe('Open a pull request');
    expect(getToolDisplay('cloudflare_register_domain').label).toBe('Register a domain');
    expect(getToolDisplay('vercel_trigger_deployment').label).toBe('Trigger a Vercel deployment');
    expect(getToolDisplay('supabase_stage_migration').label).toBe('Stage a Supabase migration');
  });

  it('renders marketing tools as posts / sends', () => {
    expect(getToolDisplay('linkedin_post').label).toBe('Post to LinkedIn');
    expect(getToolDisplay('twitter_post').label).toBe('Post to Twitter');
  });
});

describe('getToolDisplay — risk classification', () => {
  it('defaults unknown tools to high risk', () => {
    expect(getToolDisplay('some_brand_new_destructive_tool').risk).toBe('high');
  });

  it('flags external comms + infra writes as high risk', () => {
    expect(getToolDisplay('send_email').risk).toBe('high');
    expect(getToolDisplay('github_open_pr').risk).toBe('high');
    expect(getToolDisplay('cloudflare_delete_record').risk).toBe('high');
    expect(getToolDisplay('vercel_set_env_vars').risk).toBe('high');
    expect(getToolDisplay('linkedin_post').risk).toBe('high');
  });

  it('flags image / video generation as low risk (cost only, no blast radius)', () => {
    expect(getToolDisplay('replicate_generate_image').risk).toBe('low');
    expect(getToolDisplay('openai_generate_image').risk).toBe('low');
    expect(getToolDisplay('openai_edit_image').risk).toBe('low');
  });

  it('flags purely-internal logging + state-tagging as low risk', () => {
    expect(getToolDisplay('note_on_person').risk).toBe('low');
    expect(getToolDisplay('mark_person_hot').risk).toBe('low');
    expect(getToolDisplay('set_followup').risk).toBe('low');
  });
});

describe('humanize — fallback for unmapped tool names', () => {
  it('converts snake_case to Title Case Phrase', () => {
    expect(_internals.humanize('open_a_pr')).toBe('Open A Pr');
    expect(_internals.humanize('some_tool')).toBe('Some Tool');
  });

  it('handles single words', () => {
    expect(_internals.humanize('refresh')).toBe('Refresh');
  });

  it('handles empty / trailing underscores gracefully', () => {
    expect(_internals.humanize('foo__bar')).toBe('Foo Bar');
    expect(_internals.humanize('')).toBe('');
  });
});

describe('getToolDisplay — fallback path', () => {
  it('uses humanize when no explicit label is registered', () => {
    expect(getToolDisplay('publish_release_notes').label).toBe('Publish Release Notes');
  });
});
