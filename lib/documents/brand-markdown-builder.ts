/**
 * Brand kit markdown builder — pure function.
 *
 * Takes the wizard state and produces the canonical brand-kit document. Pure
 * so it's easy to test and reuse: the wizard preview and the server save path
 * both call this exact builder so what the founder sees is what gets written.
 *
 * Inputs are forgiving: empty optional strings are dropped, missing logo URL
 * just omits the image line. The shape of the markdown is locked — sections
 * always in the same order, headings always the same text. A designer reading
 * this in five minutes should know what to do.
 */

export type BrandMood = 'editorial' | 'confident' | 'quiet';

export const MOOD_LABEL: Record<BrandMood, string> = {
  editorial: 'Editorial',
  confident: 'Confident',
  quiet: 'Quiet',
};

export interface BrandKitInput {
  voice: {
    descriptors: string[];
    loved?: string;
    banned?: string;
  };
  palette: {
    primary: string;
    mood: BrandMood;
    neutrals: { name: string; hex: string }[];
  };
  typography: {
    preset: string;
    heading: string;
    body: string;
  };
  logo: {
    prompt: string;
    url?: string;
  };
}

function cleanHex(hex: string): string {
  // Normalize to "#rrggbb" lowercase. If garbage is passed, return the input
  // — the markdown is a hint to a designer, not a hard contract.
  const trimmed = hex.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
    const r = trimmed[1]!;
    const g = trimmed[2]!;
    const b = trimmed[3]!;
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return trimmed;
}

export function buildBrandKitMarkdown(input: BrandKitInput): string {
  const lines: string[] = [];

  lines.push('# Brand kit');
  lines.push('');

  // ── Voice ───────────────────────────────────────────────────────────────
  lines.push('## Voice');
  lines.push('');
  const descriptors = input.voice.descriptors
    .map((d) => d.trim())
    .filter(Boolean);
  if (descriptors.length > 0) {
    lines.push(`We sound: **${descriptors.join(', ')}**.`);
  } else {
    lines.push('We sound: **—**.');
  }
  lines.push('');

  const loved = input.voice.loved?.trim();
  const banned = input.voice.banned?.trim();
  if (loved) {
    lines.push(`A sentence we love: "${loved}"`);
  }
  if (banned) {
    lines.push(`A sentence we'd never write: "${banned}"`);
  }
  if (loved || banned) lines.push('');

  // ── Palette ─────────────────────────────────────────────────────────────
  lines.push('## Palette');
  lines.push('');
  lines.push(`**Primary:** \`${cleanHex(input.palette.primary)}\``);
  lines.push(`**Mood:** ${MOOD_LABEL[input.palette.mood]}`);
  lines.push('');
  lines.push('**Neutrals:**');
  for (const n of input.palette.neutrals) {
    lines.push(`- ${n.name} — \`${cleanHex(n.hex)}\``);
  }
  lines.push('');

  // ── Typography ──────────────────────────────────────────────────────────
  lines.push('## Typography');
  lines.push('');
  lines.push(`**Pairing:** ${input.typography.preset}`);
  lines.push(`- Heading: ${input.typography.heading}`);
  lines.push(`- Body: ${input.typography.body}`);
  lines.push('');

  // ── Logo ────────────────────────────────────────────────────────────────
  lines.push('## Logo');
  lines.push('');
  lines.push(`**Prompt seed:** ${input.logo.prompt.trim() || '—'}`);
  if (input.logo.url) {
    lines.push('');
    lines.push(`![Logo preview](${input.logo.url})`);
  }
  lines.push('');

  return lines.join('\n');
}

/**
 * Narrow runtime validator for the wizard payload. Returns the normalized
 * input on success, or a string error message on failure. We keep this loose:
 * the wizard is a UX guide, not a contract surface. Reject obviously-bad
 * shapes; let optional fields be missing.
 */
export function validateBrandKitInput(raw: unknown): BrandKitInput | string {
  if (!raw || typeof raw !== 'object') return 'Body must be an object';
  const obj = raw as Record<string, unknown>;

  // Voice
  const v = obj.voice as Record<string, unknown> | undefined;
  if (!v || typeof v !== 'object') return 'voice is required';
  const descriptors = Array.isArray(v.descriptors)
    ? (v.descriptors.filter((d) => typeof d === 'string') as string[])
    : [];
  if (descriptors.length === 0) return 'voice.descriptors must include at least one item';
  if (descriptors.length > 3) return 'voice.descriptors may not exceed 3 items';

  // Palette
  const p = obj.palette as Record<string, unknown> | undefined;
  if (!p || typeof p !== 'object') return 'palette is required';
  if (typeof p.primary !== 'string' || !/^#[0-9a-fA-F]{3,8}$/.test(p.primary.trim())) {
    return 'palette.primary must be a hex color';
  }
  if (p.mood !== 'editorial' && p.mood !== 'confident' && p.mood !== 'quiet') {
    return 'palette.mood must be editorial | confident | quiet';
  }
  if (!Array.isArray(p.neutrals)) return 'palette.neutrals must be an array';
  const neutrals: { name: string; hex: string }[] = [];
  for (const n of p.neutrals as unknown[]) {
    const nn = n as Record<string, unknown>;
    if (typeof nn?.name !== 'string' || typeof nn?.hex !== 'string') {
      return 'palette.neutrals entries must have name + hex';
    }
    neutrals.push({ name: nn.name, hex: nn.hex });
  }

  // Typography
  const t = obj.typography as Record<string, unknown> | undefined;
  if (!t || typeof t !== 'object') return 'typography is required';
  if (typeof t.preset !== 'string' || typeof t.heading !== 'string' || typeof t.body !== 'string') {
    return 'typography requires preset, heading, body strings';
  }

  // Logo
  const l = obj.logo as Record<string, unknown> | undefined;
  if (!l || typeof l !== 'object') return 'logo is required';
  if (typeof l.prompt !== 'string') return 'logo.prompt must be a string';

  return {
    voice: {
      descriptors,
      loved: typeof v.loved === 'string' ? v.loved : undefined,
      banned: typeof v.banned === 'string' ? v.banned : undefined,
    },
    palette: {
      primary: p.primary,
      mood: p.mood as BrandMood,
      neutrals,
    },
    typography: {
      preset: t.preset,
      heading: t.heading,
      body: t.body,
    },
    logo: {
      prompt: l.prompt,
      url: typeof l.url === 'string' ? l.url : undefined,
    },
  };
}
