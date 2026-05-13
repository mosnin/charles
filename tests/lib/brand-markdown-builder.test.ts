/**
 * Pure-function tests for the brand kit markdown builder + validator.
 *
 * The builder is the single source of truth for the saved Document content;
 * the wizard preview and the server save route both go through it. So we lock
 * down both shape (headings, sections, ordering) and behavior on edges
 * (missing optionals, weird hex formats, the URL toggle).
 */

import { describe, it, expect } from 'vitest';
import {
  buildBrandKitMarkdown,
  validateBrandKitInput,
  MOOD_LABEL,
  type BrandKitInput,
} from '@/lib/documents/brand-markdown-builder';

function fullInput(overrides: Partial<BrandKitInput> = {}): BrandKitInput {
  return {
    voice: {
      descriptors: ['Confident', 'Calm'],
      loved: 'We ship.',
      banned: 'We unleash the future.',
    },
    palette: {
      primary: '#0A0A0F',
      mood: 'editorial',
      neutrals: [
        { name: 'White', hex: '#ffffff' },
        { name: 'Light gray', hex: '#f4f4f5' },
        { name: 'Dark gray', hex: '#52525b' },
        { name: 'Black', hex: '#0a0a0a' },
      ],
    },
    typography: {
      preset: 'Editorial',
      heading: 'Tiempos Headline',
      body: 'Inter',
    },
    logo: {
      prompt: 'A minimal mark.',
    },
    ...overrides,
  };
}

describe('buildBrandKitMarkdown', () => {
  it('emits the four sections in canonical order', () => {
    const md = buildBrandKitMarkdown(fullInput());
    expect(md.startsWith('# Brand kit')).toBe(true);
    const idxVoice = md.indexOf('## Voice');
    const idxPalette = md.indexOf('## Palette');
    const idxType = md.indexOf('## Typography');
    const idxLogo = md.indexOf('## Logo');
    expect(idxVoice).toBeGreaterThan(0);
    expect(idxPalette).toBeGreaterThan(idxVoice);
    expect(idxType).toBeGreaterThan(idxPalette);
    expect(idxLogo).toBeGreaterThan(idxType);
  });

  it('joins descriptors with comma + space and bolds them', () => {
    const md = buildBrandKitMarkdown(fullInput());
    expect(md).toContain('We sound: **Confident, Calm**.');
  });

  it('omits "loved" / "banned" lines when not provided', () => {
    const md = buildBrandKitMarkdown(
      fullInput({ voice: { descriptors: ['Bold'] } }),
    );
    expect(md).not.toContain('A sentence we love');
    expect(md).not.toContain("never write");
    expect(md).toContain('We sound: **Bold**.');
  });

  it('includes the loved sentence in quotes', () => {
    const md = buildBrandKitMarkdown(fullInput());
    expect(md).toContain('A sentence we love: "We ship."');
  });

  it('includes the banned sentence in quotes', () => {
    const md = buildBrandKitMarkdown(fullInput());
    expect(md).toContain('A sentence we\'d never write: "We unleash the future."');
  });

  it('renders the primary hex in backticks and lowercases it', () => {
    const md = buildBrandKitMarkdown(fullInput({
      palette: {
        primary: '#AABBCC',
        mood: 'confident',
        neutrals: [{ name: 'White', hex: '#FFFFFF' }],
      },
    }));
    expect(md).toContain('**Primary:** `#aabbcc`');
  });

  it('uses the canonical mood label for each mood value', () => {
    for (const mood of ['editorial', 'confident', 'quiet'] as const) {
      const md = buildBrandKitMarkdown(fullInput({
        palette: {
          primary: '#000000',
          mood,
          neutrals: [{ name: 'White', hex: '#ffffff' }],
        },
      }));
      expect(md).toContain(`**Mood:** ${MOOD_LABEL[mood]}`);
    }
  });

  it('renders every neutral as a list item with backticked hex', () => {
    const md = buildBrandKitMarkdown(fullInput());
    expect(md).toContain('- White — `#ffffff`');
    expect(md).toContain('- Dark gray — `#52525b`');
  });

  it('renders the typography pairing with heading + body lines', () => {
    const md = buildBrandKitMarkdown(fullInput());
    expect(md).toContain('**Pairing:** Editorial');
    expect(md).toContain('- Heading: Tiempos Headline');
    expect(md).toContain('- Body: Inter');
  });

  it('renders the prompt seed', () => {
    const md = buildBrandKitMarkdown(fullInput());
    expect(md).toContain('**Prompt seed:** A minimal mark.');
  });

  it('omits the image when no logo URL is present', () => {
    const md = buildBrandKitMarkdown(fullInput());
    expect(md).not.toContain('![Logo preview]');
  });

  it('embeds the image when a logo URL is present', () => {
    const md = buildBrandKitMarkdown(
      fullInput({ logo: { prompt: 'x', url: 'https://img/y.png' } }),
    );
    expect(md).toContain('![Logo preview](https://img/y.png)');
  });

  it('expands short hex (#abc → #aabbcc)', () => {
    const md = buildBrandKitMarkdown(fullInput({
      palette: {
        primary: '#abc',
        mood: 'quiet',
        neutrals: [{ name: 'Off-white', hex: '#fff' }],
      },
    }));
    expect(md).toContain('`#aabbcc`');
    expect(md).toContain('`#ffffff`');
  });
});

describe('validateBrandKitInput', () => {
  it('accepts a complete payload', () => {
    const res = validateBrandKitInput(fullInput());
    expect(typeof res).toBe('object');
  });

  it('rejects non-object body', () => {
    expect(typeof validateBrandKitInput(null)).toBe('string');
    expect(typeof validateBrandKitInput('hi')).toBe('string');
  });

  it('rejects empty descriptors', () => {
    const res = validateBrandKitInput({
      ...fullInput(),
      voice: { descriptors: [] },
    });
    expect(res).toMatch(/descriptors/);
  });

  it('rejects more than 3 descriptors', () => {
    const res = validateBrandKitInput({
      ...fullInput(),
      voice: { descriptors: ['a', 'b', 'c', 'd'] },
    });
    expect(res).toMatch(/3/);
  });

  it('rejects a bad primary hex', () => {
    const res = validateBrandKitInput({
      ...fullInput(),
      palette: { ...fullInput().palette, primary: 'red' },
    });
    expect(res).toMatch(/primary/);
  });

  it('rejects an unknown mood', () => {
    const res = validateBrandKitInput({
      ...fullInput(),
      palette: { ...fullInput().palette, mood: 'loud' },
    });
    expect(res).toMatch(/mood/);
  });

  it('rejects missing typography fields', () => {
    const res = validateBrandKitInput({
      ...fullInput(),
      typography: { preset: 'X' },
    });
    expect(typeof res).toBe('string');
  });

  it('passes through optional voice strings', () => {
    const res = validateBrandKitInput({
      ...fullInput(),
      voice: { descriptors: ['Bold'], loved: 'hi', banned: 'no' },
    });
    if (typeof res === 'string') throw new Error(res);
    expect(res.voice.loved).toBe('hi');
    expect(res.voice.banned).toBe('no');
  });
});
