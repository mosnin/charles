/**
 * PRD prompt template — pure builders for the autogenerate path.
 *
 * One job: turn whatever the workspace knows about the company into a tight,
 * opinionated Product Requirements Document. Decisions over options. Six
 * sections, fixed order, no marketing fluff. The system prompt holds the
 * shape; the user prompt stuffs the facts.
 */

export interface PrdInput {
  workspaceName: string;
  missionTitle: string | null;
  oneLinePitch: string | null;
  targetCustomer: string | null;
  productDescription: string | null;
  brandVoice: string | null;
  coreMemorySlots: Record<string, string | null>;
}

const NOT_SET = '(not set)';

/**
 * System prompt — locks the PRD shape. Six sections, markdown only, decisions
 * over options. We deliberately forbid headers above `#` so the document opens
 * with its own title and slots into the editor without rewrites.
 */
export function buildPrdSystemPrompt(): string {
  return [
    'You write Product Requirement Documents for early-stage startups.',
    'Tight, opinionated, decisions over options. No filler, no marketing voice,',
    'no hedging. A builder should be able to read this in five minutes and know',
    'what to ship next.',
    '',
    'Output format: markdown only. The document begins with a single `#` title.',
    'No content above that title. Do not wrap the output in code fences. Do not',
    'add a preamble, sign-off, or commentary outside the document body.',
    '',
    'Required sections, in this order, each as a `##` heading:',
    '1. Problem      — the specific pain, in one or two paragraphs.',
    '2. Customer     — who feels it sharpest. Be concrete. Avoid "everyone".',
    '3. Solution     — what we are building, in builder-speak. Name the verbs.',
    '4. Scope        — two subsections under `###`: "v1 in" and "v1 out". Bulleted.',
    '5. Success metrics — 3 to 5 numbers we will watch. Name the threshold.',
    '6. Risks        — what kills this. Be honest. 3 to 5 bullets.',
    '',
    'Voice rules:',
    '- No "leverage", "synergy", "best-in-class", "world-class", "revolutionary".',
    '- No questions back to the reader. Make the call.',
    '- Use the company\'s brand voice when supplied; otherwise plain and direct.',
    '- Length target: 400 to 700 words for the body, excluding the title.',
  ].join('\n');
}

/** Render the input as labeled fields. Null/empty values collapse to `(not set)`
 *  so the model sees the same shape every time. Core memory slots come last and
 *  only when there are any. */
export function buildPrdUserPrompt(input: PrdInput): string {
  const lines: string[] = [];

  lines.push('Draft a Product PRD for the following company.');
  lines.push('');
  lines.push(`Workspace: ${input.workspaceName.trim() || NOT_SET}`);
  lines.push(`Mission: ${cleanField(input.missionTitle)}`);
  lines.push(`One-line pitch: ${cleanField(input.oneLinePitch)}`);
  lines.push(`Target customer: ${cleanField(input.targetCustomer)}`);
  lines.push(`Product description: ${cleanField(input.productDescription)}`);
  lines.push(`Brand voice: ${cleanField(input.brandVoice)}`);

  const slots = Object.entries(input.coreMemorySlots ?? {});
  if (slots.length > 0) {
    lines.push('');
    lines.push('Core memory slots:');
    for (const [slot, value] of slots) {
      lines.push(`- ${slot}: ${cleanField(value)}`);
    }
  }

  lines.push('');
  lines.push(
    'Write the PRD now. Markdown only. ~400-700 words for the body. ' +
      'Start with `# ' +
      (input.missionTitle?.trim() || input.workspaceName.trim() || 'Product') +
      ' — Product PRD`.',
  );

  return lines.join('\n');
}

function cleanField(v: string | null | undefined): string {
  if (v === null || v === undefined) return NOT_SET;
  const trimmed = v.trim();
  return trimmed.length === 0 ? NOT_SET : trimmed;
}
