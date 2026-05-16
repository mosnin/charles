/**
 * Per-department page config — pins the keyword classifier behaviour for
 * Engineering. The classifier is heuristic v1; when this map is replaced
 * by a structured `category` field on AgentActivityLog.metadata, these
 * tests come with it.
 */
import { describe, it, expect } from 'vitest';
import {
  getDepartmentPageConfig,
  DEPARTMENT_PAGE_CONFIGS,
  _internals,
} from '@/lib/departments/page-config';

describe('getDepartmentPageConfig', () => {
  it('returns the Engineering config', () => {
    const c = getDepartmentPageConfig('engineering');
    expect(c).not.toBeNull();
    expect(c!.filters.map((f) => f.slug)).toEqual([
      'repos',
      'deploys',
      'env',
      'database',
    ]);
    expect(c!.toolkits.map((t) => t.toolkit).sort()).toEqual(
      ['cloudflare', 'github', 'supabase_target', 'vercel'].sort(),
    );
  });

  it('returns the Marketing config with all 5 toolkits', () => {
    const c = getDepartmentPageConfig('marketing');
    expect(c).not.toBeNull();
    expect(c!.toolkits.map((t) => t.toolkit).sort()).toEqual(
      ['linkedin', 'loops', 'posthog', 'replicate', 'twitter'].sort(),
    );
  });

  it('returns the Design config with brand / assets / docs', () => {
    const c = getDepartmentPageConfig('design');
    expect(c).not.toBeNull();
    expect(c!.filters.map((f) => f.slug)).toEqual(['brand', 'assets', 'docs']);
  });

  it('returns the Ops/Finance config with Stripe as its sole toolkit', () => {
    const c = getDepartmentPageConfig('ops_finance');
    expect(c).not.toBeNull();
    expect(c!.toolkits.map((t) => t.toolkit)).toEqual(['stripe']);
  });

  it('returns Sales with coming-soon toolkit tiles (Apollo, Clearbit, HubSpot)', () => {
    const s = getDepartmentPageConfig('sales');
    expect(s).not.toBeNull();
    expect(s!.toolkits.map((t) => t.toolkit).sort()).toEqual(
      ['apollo', 'clearbit', 'hubspot'].sort(),
    );
    expect(s!.toolkits.every((t) => t.comingSoon === true)).toBe(true);
  });

  it('returns Support with Intercom as a coming-soon tile', () => {
    const s = getDepartmentPageConfig('support');
    expect(s).not.toBeNull();
    expect(s!.toolkits.map((t) => t.toolkit)).toEqual(['intercom']);
    expect(s!.toolkits[0].comingSoon).toBe(true);
  });
});

describe('Engineering classifier', () => {
  const eng = _internals.ENGINEERING_CONFIG;

  it('routes PR / repo / commit / branch language to repos', () => {
    expect(eng.classify('Opened pull request #42 on charles/web')).toBe('repos');
    expect(eng.classify('Committed a fix to the main branch')).toBe('repos');
    expect(eng.classify('Created a new repo')).toBe('repos');
  });

  it('routes deploy / vercel / build language to deploys', () => {
    expect(eng.classify('Deployed charles to production')).toBe('deploys');
    expect(eng.classify('Triggered a Vercel build')).toBe('deploys');
  });

  it('routes dns / cloudflare / env language to env', () => {
    expect(eng.classify('Updated DNS record charles.app A 1.2.3.4')).toBe('env');
    expect(eng.classify('Set environment variable POSTGRES_URL on Vercel')).toBe('env');
    expect(eng.classify('Added a Cloudflare CNAME')).toBe('env');
  });

  it('routes migration / supabase / schema language to database', () => {
    expect(eng.classify('Staged Supabase migration adding email column')).toBe(
      'database',
    );
    expect(eng.classify('Modified the table schema')).toBe('database');
  });

  it('falls back to general when nothing matches', () => {
    expect(eng.classify('Did some research')).toBe('general');
    expect(eng.classify('')).toBe('general');
  });

  it('database wins over deploys when both appear', () => {
    // Order matters in the classifier — database is more specific.
    expect(eng.classify('Staged migration before the next deploy')).toBe('database');
  });
});

describe('Marketing classifier', () => {
  const m = _internals.MARKETING_CONFIG;

  it('routes social platforms to social', () => {
    expect(m.classify('Posted to LinkedIn')).toBe('social');
    expect(m.classify('Tweet went out')).toBe('social');
  });

  it('routes image gen to images', () => {
    expect(m.classify('Generated an image with Replicate')).toBe('images');
    expect(m.classify('Generated a video for the launch')).toBe('images');
  });

  it('routes campaign / loops / broadcast language to campaigns', () => {
    expect(m.classify('Sent a Loops campaign to 200 subscribers')).toBe('campaigns');
    expect(m.classify('Scheduled an email broadcast')).toBe('campaigns');
  });

  it('routes PostHog / signups / metrics to analytics', () => {
    expect(m.classify('Tracked signups in PostHog')).toBe('analytics');
    expect(m.classify('Conversion rate climbed 4%')).toBe('analytics');
  });

  it('analytics wins over social when both appear', () => {
    expect(m.classify('PostHog event for a LinkedIn post')).toBe('analytics');
  });
});

describe('Design classifier', () => {
  const d = _internals.DESIGN_CONFIG;

  it('routes logo / palette / wordmark to brand', () => {
    expect(d.classify('Generated a new logo concept')).toBe('brand');
    expect(d.classify('Picked a new colour palette')).toBe('brand');
  });

  it('routes generic asset generation to assets', () => {
    expect(d.classify('Generated an image for the hero')).toBe('assets');
  });

  it('routes style-doc work to docs', () => {
    expect(d.classify('Updated the style guide')).toBe('docs');
  });
});

describe('Ops/Finance classifier', () => {
  const o = _internals.OPS_FINANCE_CONFIG;

  it('routes revenue / stripe / charge / subscription to revenue', () => {
    expect(o.classify('Stripe charge of $99 landed')).toBe('revenue');
    expect(o.classify('MRR climbed to $4,200')).toBe('revenue');
  });

  it('routes expense / spend language to expenses', () => {
    expect(o.classify('Paid for the OpenAI invoice')).toBe('expenses');
  });

  it('routes runway / burn / forecast to runway', () => {
    expect(o.classify('Runway updated: 14 months at current burn')).toBe('runway');
    expect(o.classify('Cash balance forecast')).toBe('runway');
  });
});

describe('Sales classifier', () => {
  const s = _internals.SALES_CONFIG;

  it('routes outreach / follow-up / cold language to outreach', () => {
    expect(s.classify('Sent an outreach email to Acme')).toBe('outreach');
    expect(s.classify('Follow up scheduled')).toBe('outreach');
  });

  it('routes research / company profile to research', () => {
    expect(s.classify('Pulled a company profile on Acme')).toBe('research');
  });

  it('routes enrich / apollo / clearbit to enrich', () => {
    expect(s.classify('Enriched contact via Apollo')).toBe('enrich');
  });
});

describe('Support classifier', () => {
  const s = _internals.SUPPORT_CONFIG;

  it('routes ticket / inbox / reply to inbox', () => {
    expect(s.classify('Replied to a customer ticket')).toBe('inbox');
  });

  it('routes templates to templates', () => {
    expect(s.classify('Created a canned reply template')).toBe('templates');
  });
});

describe('DEPARTMENT_PAGE_CONFIGS coverage', () => {
  it('every department slug has a page config wired (phase 5 complete)', () => {
    expect(Object.keys(DEPARTMENT_PAGE_CONFIGS).sort()).toEqual([
      'design',
      'engineering',
      'marketing',
      'ops_finance',
      'sales',
      'support',
    ]);
  });
});
