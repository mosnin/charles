/**
 * Pin the visibility contract for ConvexHealthBadge.
 *
 * The component is a fetch loop + one conditional render. We extract
 * the rendering decision and the response-body parser into pure
 * helpers so we can pin the behavior without standing up jsdom (this
 * project deliberately doesn't ship a DOM env). The contract: amber
 * dot ONLY for the unhealthy state; complete silence otherwise.
 */

import { describe, it, expect } from 'vitest';
import {
  shouldRenderBadge,
  stateFromBody,
  POLL_MS,
  type HealthState,
} from '@/components/canvas/convex-health-badge';

describe('shouldRenderBadge', () => {
  it('renders nothing when the layer is healthy', () => {
    expect(shouldRenderBadge('healthy')).toBe(false);
  });

  it('renders nothing when the deployment is unconfigured (first-time dev)', () => {
    expect(shouldRenderBadge('unconfigured')).toBe(false);
  });

  it('renders nothing while the initial state is still unknown', () => {
    expect(shouldRenderBadge('unknown')).toBe(false);
  });

  it('renders the amber dot when the layer is unhealthy', () => {
    expect(shouldRenderBadge('unhealthy')).toBe(true);
  });

  it('is exhaustive over the union', () => {
    const all: HealthState[] = ['healthy', 'unhealthy', 'unconfigured', 'unknown'];
    const rendered = all.filter(shouldRenderBadge);
    expect(rendered).toEqual(['unhealthy']);
  });
});

describe('stateFromBody', () => {
  it('maps a healthy body to healthy', () => {
    expect(stateFromBody({ status: 'healthy', latencyMs: 12 })).toBe('healthy');
  });

  it('maps an unconfigured body to unconfigured', () => {
    expect(stateFromBody({ status: 'unconfigured', message: 'no url' })).toBe(
      'unconfigured',
    );
  });

  it('maps an unhealthy body to unhealthy', () => {
    expect(stateFromBody({ status: 'unhealthy', error: 'boom' })).toBe(
      'unhealthy',
    );
  });

  it('defaults to unhealthy for an unknown status string', () => {
    expect(stateFromBody({ status: 'weird' })).toBe('unhealthy');
  });

  it('defaults to unhealthy for null/undefined bodies (malformed JSON)', () => {
    expect(stateFromBody(null)).toBe('unhealthy');
    expect(stateFromBody(undefined)).toBe('unhealthy');
  });

  it('defaults to unhealthy for non-object bodies', () => {
    expect(stateFromBody('healthy')).toBe('unhealthy');
    expect(stateFromBody(42)).toBe('unhealthy');
  });

  it('defaults to unhealthy when status is missing', () => {
    expect(stateFromBody({ latencyMs: 12 })).toBe('unhealthy');
  });
});

describe('POLL_MS', () => {
  it('polls once a minute — quiet by design', () => {
    expect(POLL_MS).toBe(60_000);
  });
});
