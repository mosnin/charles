/**
 * Onboarding step copy — extracted so tests can pin the founder-readable
 * labels and the step ordering. The wizard reads from here; nothing in the
 * client component composes labels itself.
 *
 * Voice notes (Jobs lens):
 *  - Sentence case, period at the end.
 *  - Verbs over nouns. One idea per line.
 *  - Subhead is the one-line "why this step exists".
 *
 * Field copy stays minimal — placeholders are nudges, not instructions.
 */

export const STEP_IDS = ['company', 'idea', 'github', 'template'] as const;
export type StepId = (typeof STEP_IDS)[number];

export const TOTAL_STEPS = STEP_IDS.length;

export interface FieldCopy {
  key: string;
  label: string;
  placeholder: string;
  maxLength: number;
  multiline?: boolean;
  rows?: number;
}

export interface StepCopy {
  id: StepId;
  /** The serif H1 question. */
  title: string;
  /** The single quiet subhead line under the H1. */
  subtitle: string;
  /** Optional field metadata — present only on multi-field steps. */
  fields?: FieldCopy[];
}

export const STEP_COPY: Record<StepId, StepCopy> = {
  company: {
    id: 'company',
    title: 'Name the company.',
    subtitle: 'You can rename anything later. Charles just needs a thread to pull.',
    fields: [
      {
        key: 'companyName',
        label: 'Company name',
        placeholder: 'Acme',
        maxLength: 120,
      },
      {
        key: 'tagline',
        label: 'Tagline',
        placeholder: 'One sentence. What does it do?',
        maxLength: 200,
      },
      {
        key: 'founderName',
        label: 'Your name',
        placeholder: 'Alex Kim',
        maxLength: 120,
      },
    ],
  },
  idea: {
    id: 'idea',
    title: 'Tell Charles the idea.',
    subtitle: 'Be specific. Charles uses this to scope the first week of work.',
    fields: [
      {
        key: 'whatBuilding',
        label: 'What are you building?',
        placeholder: 'Two or three sentences. What it does. Why it matters.',
        maxLength: 800,
        multiline: true,
        rows: 3,
      },
      {
        key: 'oneLinePitch',
        label: 'One-line pitch',
        placeholder: 'What it does, for whom.',
        maxLength: 200,
      },
      {
        key: 'targetCustomer',
        label: 'Who has the problem?',
        placeholder: 'The person you are solving for.',
        maxLength: 200,
      },
    ],
  },
  github: {
    id: 'github',
    title: 'Connect GitHub.',
    subtitle: 'Charles needs a repo to scaffold, branch, and open PRs against.',
  },
  template: {
    id: 'template',
    title: 'Pick a starting point.',
    subtitle:
      'Each template seeds your mission, gates, and documents. Skip if you want a blank workspace.',
  },
};

/** "step 1 / 3" — the mono chip under the sapling. */
export function stepChip(stepIndex: number): string {
  return `step ${stepIndex + 1} / ${TOTAL_STEPS}`;
}
