/**
 * Pure state helpers for the onboarding wizard.
 *
 * Kept separate from `wizard-client.tsx` so unit tests can pin validation,
 * step advancement, and the API payload shape without rendering React.
 * Step-shape is passed in rather than imported so this module stays free
 * of the step-copy.ts contract churn while Agent B extends it.
 */

export type StepKind =
  | 'intro'
  | 'text'
  | 'textarea'
  | 'options'
  | 'scrubber'
  | 'github'
  | 'done';

export interface StepShape {
  kind: StepKind;
  field?: string;
}

export interface WizardValues {
  founderName: string;
  companyName: string;
  whatBuilding: string;
  targetCustomer: string;
  ideaStage: string;
  founderRole: string;
  technicalExperience: string;
  githubConnected: boolean;
  githubSkipped: boolean;
}

export interface CompletePayload {
  founderName: string;
  companyName: string;
  whatBuilding: string;
  targetCustomer: string;
  ideaStage: string;
  founderRole: string;
  technicalExperience: string;
  githubConnected: boolean;
}

const TEXTAREA_MIN_CHARS = 8;

/**
 * Is the current step valid given the form values? Returning true unlocks the
 * primary CTA. Calm rejection — the button just stays soft when invalid.
 */
export function isStepValid(step: StepShape, values: WizardValues): boolean {
  switch (step.kind) {
    case 'intro':
    case 'done':
    case 'github':
      return true;
    case 'text': {
      if (!step.field) return false;
      const v = values[step.field as keyof WizardValues];
      return typeof v === 'string' && v.trim().length > 0;
    }
    case 'textarea': {
      if (!step.field) return false;
      const v = values[step.field as keyof WizardValues];
      return typeof v === 'string' && v.trim().length >= TEXTAREA_MIN_CHARS;
    }
    case 'options': {
      if (!step.field) return false;
      const v = values[step.field as keyof WizardValues];
      return typeof v === 'string' && v !== '';
    }
    case 'scrubber': {
      if (!step.field) return false;
      const v = values[step.field as keyof WizardValues];
      return typeof v === 'string' && v !== '';
    }
    default:
      return false;
  }
}

/**
 * Advance the step index, clamped to [0, totalSteps - 1]. The wizard calls
 * this on Continue when it is not on the final step.
 */
export function nextStepIndex(stepIndex: number, totalSteps: number): number {
  if (totalSteps <= 0) return 0;
  if (stepIndex < 0) return 0;
  if (stepIndex >= totalSteps - 1) return totalSteps - 1;
  return stepIndex + 1;
}

/**
 * Walk one step back, clamped to 0. Used by the keyboard arrow-left handler
 * and the subtle "← Back" link on screens 2+.
 */
export function prevStepIndex(stepIndex: number): number {
  return stepIndex <= 0 ? 0 : stepIndex - 1;
}

/**
 * The exact JSON body posted to /api/onboarding/complete. Strings are
 * trimmed; githubSkipped is dropped from the payload (server doesn't care).
 */
export function payloadFromValues(values: WizardValues): CompletePayload {
  return {
    founderName: values.founderName.trim(),
    companyName: values.companyName.trim(),
    whatBuilding: values.whatBuilding.trim(),
    targetCustomer: values.targetCustomer.trim(),
    ideaStage: values.ideaStage,
    founderRole: values.founderRole,
    technicalExperience: values.technicalExperience,
    githubConnected: values.githubConnected,
  };
}

/**
 * Default form values for a fresh wizard mount. `ideaStage` is seeded to "idea"
 * so the scrubber has a meaningful default; founderName is optionally
 * pre-filled from Clerk.
 */
export function defaultValues(defaultFounderName = ''): WizardValues {
  return {
    founderName: defaultFounderName,
    companyName: '',
    whatBuilding: '',
    targetCustomer: '',
    ideaStage: 'idea',
    founderRole: '',
    technicalExperience: '',
    githubConnected: false,
    githubSkipped: false,
  };
}
