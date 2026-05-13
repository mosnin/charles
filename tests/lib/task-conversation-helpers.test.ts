/**
 * Pure-helper tests for the per-task conversation surface.
 *
 * The bar: breadcrumbs render the right left-side label for tasks vs gates;
 * subjects come straight from the row title; the keyword classifier picks
 * the correct department for the common prompts the UX will see; the canned
 * reply names the department when one is found and stays neutral otherwise.
 */

import { describe, it, expect } from 'vitest';
import {
  breadcrumbForTask,
  breadcrumbForGate,
  subjectFromTask,
  subjectFromGate,
  classifyDepartment,
  cannedAssistantReply,
} from '@/lib/tasks/conversation-helpers';

describe('breadcrumbForTask', () => {
  it('uses the department label when the task is agent-assigned', () => {
    const b = breadcrumbForTask({
      title: 'Landing Page Updates',
      assigneeKind: 'agent',
      assigneeDept: 'engineering',
    });
    expect(b).toBe('Engineering / Landing Page Updates');
  });

  it('falls back to "Tasks" for founder-assigned rows', () => {
    const b = breadcrumbForTask({
      title: 'Reply to investor',
      assigneeKind: 'founder',
      assigneeDept: null,
    });
    expect(b).toBe('Tasks / Reply to investor');
  });

  it('falls back to "Tasks" for unassigned rows', () => {
    const b = breadcrumbForTask({
      title: 'Park this for later',
      assigneeKind: 'unassigned',
      assigneeDept: null,
    });
    expect(b).toBe('Tasks / Park this for later');
  });

  it('trims whitespace from the title', () => {
    const b = breadcrumbForTask({
      title: '   Spin up email   ',
      assigneeKind: 'agent',
      assigneeDept: 'marketing',
    });
    expect(b).toBe('Marketing / Spin up email');
  });
});

describe('breadcrumbForGate', () => {
  it('renders Stages / <stage label> / <gate title>', () => {
    const b = breadcrumbForGate({
      title: 'Approve the logo and wordmark',
      stage: 'identity',
    });
    expect(b).toBe('Stages / Identity / Approve the logo and wordmark');
  });

  it('uses the catalog stage label, not the slug', () => {
    const b = breadcrumbForGate({
      title: 'Deploy to production',
      stage: 'building',
    });
    expect(b.startsWith('Stages / Building /')).toBe(true);
  });
});

describe('subject helpers', () => {
  it('subjectFromTask returns the trimmed title', () => {
    expect(subjectFromTask({ title: '   Ship the landing page  ' })).toBe('Ship the landing page');
  });

  it('subjectFromGate returns the trimmed title', () => {
    expect(subjectFromGate({ title: '  Define your company in one sentence ' })).toBe(
      'Define your company in one sentence',
    );
  });
});

describe('classifyDepartment', () => {
  it('routes deploy/landing/website to engineering', () => {
    expect(classifyDepartment('Deploy the landing page')).toBe('engineering');
    expect(classifyDepartment('Build me a website')).toBe('engineering');
    expect(classifyDepartment('Fix the API bug')).toBe('engineering');
  });

  it('routes logo/brand to design', () => {
    expect(classifyDepartment('Draft a logo for us')).toBe('design');
    expect(classifyDepartment('Refine the wordmark')).toBe('design');
  });

  it('routes email/campaign/post to marketing', () => {
    expect(classifyDepartment('Draft the launch email')).toBe('marketing');
    expect(classifyDepartment('Write a blog post')).toBe('marketing');
  });

  it('routes prospect/outreach to sales', () => {
    expect(classifyDepartment('Find me a fresh prospect list')).toBe('sales');
    expect(classifyDepartment('Send outreach to these leads')).toBe('sales');
  });

  it('routes invoice/stripe/runway to ops_finance', () => {
    expect(classifyDepartment('Wire Stripe to live mode')).toBe('ops_finance');
    expect(classifyDepartment('How much runway do we have?')).toBe('ops_finance');
  });

  it('returns null when no keyword matches', () => {
    expect(classifyDepartment('hello there')).toBeNull();
    expect(classifyDepartment('   ')).toBeNull();
  });

  it('is case-insensitive', () => {
    expect(classifyDepartment('DEPLOY THE APP')).toBe('engineering');
  });
});

describe('cannedAssistantReply', () => {
  it('names the department when a keyword matches', () => {
    const r = cannedAssistantReply('Deploy the landing page');
    expect(r.content).toContain('Engineering');
    expect(r.metadata.delegatedTo).toBe('engineering');
  });

  it('falls back to a neutral reply when no keyword matches', () => {
    const r = cannedAssistantReply('hello there');
    expect(r.metadata.delegatedTo).toBeNull();
    expect(r.content.length).toBeGreaterThan(0);
  });

  it('never uses banned vocabulary', () => {
    const banned = ['revolutionary', 'unleash', 'supercharge', 'magic', 'seamless'];
    const r1 = cannedAssistantReply('Deploy the landing page');
    const r2 = cannedAssistantReply('hello there');
    for (const word of banned) {
      expect(r1.content.toLowerCase()).not.toContain(word);
      expect(r2.content.toLowerCase()).not.toContain(word);
    }
  });
});
