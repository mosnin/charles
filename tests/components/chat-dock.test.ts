/**
 * The chat dock holds the conversation. These tests pin the contract:
 *   - typing in the input does NOT navigate away (no router.push to /chat
 *     from submit)
 *   - the dock consumes useAgentTask for inline streaming
 *   - the dead tabs are gone (no Company, no Tasks, no Library, no Charles
 *     duplicate tab)
 *   - the empty-state copy names the relationship, not the implementation
 *   - the input placeholder is a single decision, with no trailing ellipsis
 *
 * No jsdom / testing-library in this project — these are source-text pins on
 * the public contract, the same vocabulary used by the orbit and briefing
 * tests. When someone tries to bring back the tab strip or wire the dock
 * back to a route push, one of these yells first.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DOCK = readFileSync(
  resolve(__dirname, '../../components/canvas/chat-dock.tsx'),
  'utf8',
);
const CANVAS = readFileSync(
  resolve(__dirname, '../../components/canvas/canvas-home.tsx'),
  'utf8',
);

describe('chat dock holds the conversation', () => {
  it('imports useAgentTask so streaming runs inline', () => {
    expect(DOCK).toMatch(/from '@\/components\/ai\/hooks\/use-agent-task'/);
    expect(DOCK).toMatch(/useAgentTask\(/);
  });

  it('renders the shared Transcript block view', () => {
    expect(DOCK).toMatch(/from '@\/components\/ai\/blocks\/transcript'/);
    expect(DOCK).toMatch(/<Transcript\b/);
  });

  it('surfaces permission prompts inline (no separate full-page round trip)', () => {
    expect(DOCK).toMatch(/pendingApproval/);
    expect(DOCK).toMatch(/approve/);
    expect(DOCK).toMatch(/deny/);
  });

  it('does NOT push the user to /chat on submit', () => {
    expect(DOCK).not.toMatch(/router\.push\([^)]*\/chat/);
  });
});

describe('chat dock — dead tabs are gone', () => {
  const DEAD_TABS = ['Company', 'Tasks'];
  for (const tab of DEAD_TABS) {
    it(`does not ship a "${tab}" tab`, () => {
      // No tab strip literal contains the dead name.
      expect(DOCK).not.toMatch(new RegExp(`['"]${tab}['"]`));
    });
  }

  it('does not render a Library tab inside the dock', () => {
    expect(DOCK).not.toMatch(/LibraryTab/);
    expect(DOCK).not.toMatch(/library-tab/);
  });

  it('does not say "Coming soon" anywhere', () => {
    expect(DOCK).not.toMatch(/[Cc]oming soon/);
  });

  it('does not duplicate a "Charles" tab next to Home', () => {
    // The old dock declared a `TABS` array containing 'Charles' alongside
    // 'Home'. The new dock has no tab strip at all, so neither survives.
    expect(DOCK).not.toMatch(/const TABS\s*=/);
  });
});

describe('chat dock — empty state', () => {
  it('uses calm, relationship-naming copy (not "nothing\'s happening")', () => {
    expect(DOCK).not.toMatch(/Nothing.?s happening/i);
    expect(DOCK).not.toMatch(/Press ⌘K to spin/);
  });

  it("opens with a get-to-work invite", () => {
    // Allow the HTML-entity apostrophe (Let&rsquo;s) or a literal one.
    expect(DOCK).toMatch(/Let(?:&rsquo;|')s get to work/);
  });
});

describe('chat dock — input placeholder', () => {
  it("uses one canonical placeholder — 'What are we shipping?'", () => {
    expect(DOCK).toMatch(/placeholder="What are we shipping\?"/);
  });

  it('has no trailing ellipsis on the placeholder', () => {
    // Pull out the placeholder string and check it.
    const m = DOCK.match(/placeholder="([^"]+)"/);
    expect(m).not.toBeNull();
    if (m) {
      expect(m[1]).not.toMatch(/[…]$/);
      expect(m[1]).not.toMatch(/\.\.\.$/);
    }
  });

  it('does not ship the old engineering-brain placeholder', () => {
    expect(DOCK).not.toMatch(/spin up new task agents/);
  });
});

describe('chat dock — width + collapse', () => {
  it('does not ship a collapse rail', () => {
    expect(DOCK).not.toMatch(/charles:chat-dock:collapsed/);
    expect(DOCK).not.toMatch(/Collapse chat dock/);
  });

  it('uses a responsive width on desktop (not a hardcoded 420px)', () => {
    // Allow min-w-[360px] and max-w-[480px], require min(420px, …vw) clamp.
    expect(DOCK).toMatch(/w-\[min\(420px,/);
  });
});

describe('canvas-home no longer ships dead chrome', () => {
  it('does not render FirstMoveCard (folded into dock empty state)', () => {
    expect(CANVAS).not.toMatch(/FirstMoveCard/);
  });

  it('does not pass an audit feed to the dock', () => {
    expect(CANVAS).not.toMatch(/initialAuditFeed/);
  });

  it('passes initialConversationId + initialMessages to the dock', () => {
    expect(CANVAS).toMatch(/initialConversationId/);
    expect(CANVAS).toMatch(/initialMessages/);
  });
});
