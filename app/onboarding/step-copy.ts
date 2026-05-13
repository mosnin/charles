/**
 * Onboarding step copy — the 10-screen interview the wizard runs.
 *
 * One question per screen, sentence case, no ceremony. STEPS is the single
 * source of truth: ordering, headlines, fields, options. The wizard reads
 * `kind` to choose the right atom. Tests pin the order and the option
 * vocabularies so the API contract and the UI never drift apart.
 */

export type StepKind =
  | 'intro'
  | 'text'
  | 'textarea'
  | 'options'
  | 'scrubber'
  | 'github'
  | 'done';

export interface OptionItem {
  id: string;
  label: string;
}

export interface StageItem {
  value: string;
  label: string;
}

export interface Step {
  id: string;
  kind: StepKind;
  headline: string;
  subheadline?: string;
  /** FormValues key this step writes to. Absent for intro/done/github. */
  field?: keyof FormValues;
  placeholder?: string;
  options?: readonly OptionItem[];
  stages?: readonly StageItem[];
  ctaLabel?: string;
}

export interface FormValues {
  founderName: string;
  companyName: string;
  whatBuilding: string;
  targetCustomer: string;
  stage: string;
  role: string;
  technicalExperience: string;
  githubConnected: boolean;
  githubSkipped: boolean;
}

// ── Option vocabularies (must match the API enums in /api/onboarding/complete) ─

export const STAGE_OPTIONS: readonly StageItem[] = [
  { value: 'pre-idea',  label: 'Pre-idea' },
  { value: 'idea',      label: 'Idea' },
  { value: 'pre-mvp',   label: 'Pre-MVP' },
  { value: 'mvp',       label: 'MVP' },
  { value: 'customers', label: 'Customers' },
  { value: 'revenue',   label: 'Revenue' },
  { value: 'public',    label: 'Public' },
] as const;

export const ROLE_OPTIONS: readonly OptionItem[] = [
  { id: 'product',     label: 'Product' },
  { id: 'engineering', label: 'Engineering' },
  { id: 'design',      label: 'Design' },
  { id: 'marketing',   label: 'Marketing' },
  { id: 'sales',       label: 'Sales' },
  { id: 'operations',  label: 'Operations' },
  { id: 'founder',     label: 'Founder / Executive' },
  { id: 'other',       label: 'Other' },
] as const;

export const EXPERIENCE_OPTIONS: readonly OptionItem[] = [
  { id: 'writes-code',       label: 'I write code myself' },
  { id: 'manages-engineers', label: 'I manage engineers with a dev team' },
  { id: 'non-technical',     label: "I'm not involved on the technical side" },
] as const;

// ── The 10-screen sequence ─────────────────────────────────────────────────

export const STEPS = [
  {
    id: 'intro',
    kind: 'intro',
    headline: 'Create your company.',
    subheadline: 'A short interview, then your workspace.',
    ctaLabel: 'Continue',
  },
  {
    id: 'name',
    kind: 'text',
    headline: 'What should we call you?',
    field: 'founderName',
    placeholder: 'Your name',
    ctaLabel: 'Continue',
  },
  {
    id: 'stage',
    kind: 'scrubber',
    headline: 'What stage is your idea?',
    field: 'stage',
    stages: STAGE_OPTIONS,
    ctaLabel: 'Next',
  },
  {
    id: 'role',
    kind: 'options',
    headline: 'Which best describes you?',
    field: 'role',
    options: ROLE_OPTIONS,
    ctaLabel: 'Continue',
  },
  {
    id: 'experience',
    kind: 'options',
    headline: "What's your experience building products?",
    field: 'technicalExperience',
    options: EXPERIENCE_OPTIONS,
    ctaLabel: 'Continue',
  },
  {
    id: 'companyName',
    kind: 'text',
    headline: "What's your company called?",
    field: 'companyName',
    placeholder: 'Acme',
    ctaLabel: 'Continue',
  },
  {
    id: 'whatBuilding',
    kind: 'textarea',
    headline: 'What are you building?',
    field: 'whatBuilding',
    placeholder: 'Two or three sentences. What it does. Why it matters.',
    ctaLabel: 'Continue',
  },
  {
    id: 'targetCustomer',
    kind: 'textarea',
    headline: 'Who is it for?',
    field: 'targetCustomer',
    placeholder: 'The person you are solving for.',
    ctaLabel: 'Continue',
  },
  {
    id: 'github',
    kind: 'github',
    headline: 'Connect GitHub.',
    subheadline: 'Charles needs a repo to scaffold, branch, and open PRs against.',
    ctaLabel: 'Continue',
  },
  {
    id: 'done',
    kind: 'done',
    headline: "You're in.",
    subheadline: 'Your workspace is ready.',
    ctaLabel: 'Enter workspace',
  },
] as const satisfies readonly Step[];

export type StepId = (typeof STEPS)[number]['id'];

export const STEP_IDS: readonly StepId[] = STEPS.map((s) => s.id) as readonly StepId[];

export const TOTAL_STEPS: number = STEPS.length;

/** "step 1 / 10" — the mono chip under the sapling. */
export function stepChip(stepIndex: number): string {
  return `step ${stepIndex + 1} / ${TOTAL_STEPS}`;
}
