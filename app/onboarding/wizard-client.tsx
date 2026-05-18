'use client';

/**
 * Charles onboarding — one-question-per-screen interview.
 *
 * Drives a STEPS array from `step-copy.ts`. Each screen renders inside the
 * shared OnboardingShell with sunflower or wordmark artwork. The right column
 * dispatches on `step.kind`. Continue is the only weighted action; soft
 * blue selection, no progress bar, no ceremony.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { useRouter } from 'next/navigation';
import { useClerk } from '@clerk/nextjs';
import { toast } from 'sonner';
import { Github, Loader2 } from 'lucide-react';
import { OnboardingShell } from '@/components/onboarding/onboarding-shell';
import { StageScrubber } from '@/components/onboarding/stage-scrubber';
import { NumberedOptionList } from '@/components/onboarding/numbered-option-list';
import { PrimaryContinue } from '@/components/onboarding/primary-continue';
import { TextInputRow } from '@/components/onboarding/text-input-row';
import { STEPS, TOTAL_STEPS, type FormValues, type Step } from './step-copy';
import {
  defaultValues,
  isStepValid,
  nextStepIndex,
  payloadFromValues,
  prevStepIndex,
  type StepShape,
  type WizardValues,
} from './wizard-state';

interface WizardClientProps {
  defaultFounderName?: string;
}

export function WizardClient({ defaultFounderName = '' }: WizardClientProps) {
  const router = useRouter();
  const { signOut } = useClerk();

  const [stepIndex, setStepIndex] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [connectingGitHub, setConnectingGitHub] = useState(false);
  const [values, setValues] = useState<FormValues>(() =>
    defaultValues(defaultFounderName) as unknown as FormValues,
  );

  const current = STEPS[stepIndex];
  const isLastStep = stepIndex === TOTAL_STEPS - 1;
  const valid = isStepValid(
    current as unknown as StepShape,
    values as unknown as WizardValues,
  );

  const set = useCallback(
    <K extends keyof FormValues>(key: K, value: FormValues[K]) => {
      setValues((prev: FormValues) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const handleLogout = useCallback(() => {
    void signOut(() => router.push('/sign-in'));
  }, [signOut, router]);

  const finalize = useCallback(async () => {
    setSubmitting(true);
    try {
      const res = await fetch('/api/onboarding/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          payloadFromValues(values as unknown as WizardValues),
        ),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error ?? `Request failed (${res.status})`);
      }
      router.push(`/s/${data.slug}`);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Something went wrong. Try again.';
      toast.error(msg);
      setSubmitting(false);
    }
  }, [router, values]);

  const goNext = useCallback(() => {
    if (isLastStep) {
      void finalize();
      return;
    }
    setStepIndex((i) => nextStepIndex(i, TOTAL_STEPS));
  }, [isLastStep, finalize]);

  const goBack = useCallback(() => {
    setStepIndex((i) => prevStepIndex(i));
  }, []);

  // Keyboard: arrow-left walks back on screens 2+. Esc is intentionally
  // a no-op — too easy to nuke five answers with one keystroke.
  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key === 'ArrowLeft' && stepIndex > 0 && !submitting) {
        const tag = (e.target as HTMLElement | null)?.tagName ?? '';
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        goBack();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [stepIndex, submitting, goBack]);

  async function connectGitHub() {
    if (connectingGitHub) return;
    setConnectingGitHub(true);
    try {
      const res = await fetch('/api/integrations/connect/github', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data?.error ?? 'Could not start GitHub connection.');
        return;
      }
      if (data?.url) {
        set('githubConnected', true);
        window.location.href = data.url;
      } else {
        toast.error('No auth URL returned. Try again.');
      }
    } catch {
      toast.error('Network error. Try again.');
    } finally {
      setConnectingGitHub(false);
    }
  }

  const skipGitHub = useCallback(() => {
    set('githubSkipped', true);
    goNext();
  }, [set, goNext]);

  const artwork: 'sunflower' | 'wordmark' =
    current.kind === 'intro' || current.kind === 'done'
      ? 'sunflower'
      : 'wordmark';

  return (
    <OnboardingShell artwork={artwork} onLogout={handleLogout}>
      <div
        key={stepIndex}
        className="wizard-screen mx-auto flex w-full max-w-xl flex-col gap-8"
      >
        <StepBody
          step={current}
          values={values}
          set={set}
          valid={valid}
          submitting={submitting}
          connectingGitHub={connectingGitHub}
          isLastStep={isLastStep}
          onContinue={goNext}
          onConnectGitHub={connectGitHub}
          onSkipGitHub={skipGitHub}
        />

        {stepIndex > 0 && !submitting && current.kind !== 'done' && (
          <button
            type="button"
            onClick={goBack}
            className="self-start text-sm italic text-muted-foreground transition-colors hover:text-foreground"
          >
            ← Back
          </button>
        )}
      </div>

      <style jsx>{`
        .wizard-screen {
          animation: wizard-fade 200ms ease-out both;
        }
        @keyframes wizard-fade {
          from {
            opacity: 0;
            transform: translateY(6px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .wizard-screen {
            animation: none;
          }
        }
      `}</style>
    </OnboardingShell>
  );
}

// ── Step body dispatch ─────────────────────────────────────────────────────

interface StepBodyProps {
  step: Step;
  values: FormValues;
  set: <K extends keyof FormValues>(key: K, value: FormValues[K]) => void;
  valid: boolean;
  submitting: boolean;
  connectingGitHub: boolean;
  isLastStep: boolean;
  onContinue: () => void;
  onConnectGitHub: () => void;
  onSkipGitHub: () => void;
}

function StepBody({
  step,
  values,
  set,
  valid,
  submitting,
  connectingGitHub,
  isLastStep,
  onContinue,
  onConnectGitHub,
  onSkipGitHub,
}: StepBodyProps) {
  const ctaLabel = step.ctaLabel;

  const onEnterAdvance = useCallback(
    (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (e.key !== 'Enter') return;
      // Shift+Enter in textareas should insert a newline.
      if (step.kind === 'textarea' && e.shiftKey) return;
      if (!valid || submitting) return;
      e.preventDefault();
      onContinue();
    },
    [step.kind, valid, submitting, onContinue],
  );

  switch (step.kind) {
    case 'intro':
      return (
        <>
          <Headline title={step.headline} sub={step.subheadline} large />
          <div>
            <PrimaryContinue
              label={ctaLabel ?? 'Continue'}
              onClick={onContinue}
            />
          </div>
        </>
      );

    case 'text': {
      const field = step.field as keyof FormValues;
      const v = (values[field] as string) ?? '';
      return (
        <>
          <Headline title={step.headline} sub={step.subheadline} />
          <KeyCaptureRow onEnter={onEnterAdvance}>
            <TextInputRow
              label={step.headline}
              value={v}
              onChange={(next) => set(field, next as FormValues[typeof field])}
              placeholder={step.placeholder}
              autoFocus
            />
          </KeyCaptureRow>
          <div>
            <PrimaryContinue
              label={ctaLabel ?? 'Continue'}
              disabled={!valid}
              onClick={onContinue}
              loading={submitting && isLastStep}
            />
          </div>
        </>
      );
    }

    case 'textarea': {
      const field = step.field as keyof FormValues;
      const v = (values[field] as string) ?? '';
      return (
        <>
          <Headline title={step.headline} sub={step.subheadline} />
          <KeyCaptureRow onEnter={onEnterAdvance}>
            <TextInputRow
              label={step.headline}
              value={v}
              onChange={(next) => set(field, next as FormValues[typeof field])}
              placeholder={step.placeholder}
              autoFocus
              multiline
            />
          </KeyCaptureRow>
          <div>
            <PrimaryContinue
              label={ctaLabel ?? 'Continue'}
              disabled={!valid}
              onClick={onContinue}
              loading={submitting && isLastStep}
            />
          </div>
        </>
      );
    }

    case 'options': {
      const field = step.field as keyof FormValues;
      const v = (values[field] as string) ?? '';
      return (
        <>
          <Headline title={step.headline} sub={step.subheadline} />
          <NumberedOptionList
            options={step.options ?? []}
            value={v === '' ? null : v}
            onChange={(id) => set(field, id as FormValues[typeof field])}
          />
          <div>
            <PrimaryContinue
              label={ctaLabel ?? 'Continue'}
              disabled={!valid}
              onClick={onContinue}
              loading={submitting && isLastStep}
            />
          </div>
        </>
      );
    }

    case 'scrubber': {
      const field = step.field as keyof FormValues;
      const v = (values[field] as string) ?? '';
      return (
        <>
          <Headline title={step.headline} sub={step.subheadline} />
          <StageScrubber
            stages={step.stages ?? []}
            value={v}
            onChange={(next) => set(field, next as FormValues[typeof field])}
          />
          <div>
            <PrimaryContinue
              label={ctaLabel ?? 'Next'}
              disabled={!valid}
              onClick={onContinue}
              loading={submitting && isLastStep}
            />
          </div>
        </>
      );
    }

    case 'github':
      return (
        <>
          <Headline title={step.headline} sub={step.subheadline} />
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={
                values.githubConnected ? onContinue : onConnectGitHub
              }
              disabled={connectingGitHub || submitting}
              className="inline-flex h-11 items-center gap-2 rounded-full bg-foreground px-6 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {connectingGitHub ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Github size={14} />
              )}
              {values.githubConnected
                ? 'Continue'
                : connectingGitHub
                  ? 'Connecting'
                  : 'Connect GitHub'}
            </button>
            {!values.githubConnected && (
              <button
                type="button"
                onClick={onSkipGitHub}
                disabled={connectingGitHub || submitting}
                className="text-sm italic text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
              >
                Skip for now
              </button>
            )}
          </div>
        </>
      );

    case 'done':
      return (
        <>
          <Headline title={step.headline} sub={step.subheadline} large />
          <div>
            <PrimaryContinue
              label={ctaLabel ?? 'Enter workspace'}
              onClick={onContinue}
              loading={submitting}
            />
          </div>
        </>
      );

    default:
      return null;
  }
}

// ── Small presentational bits ──────────────────────────────────────────────

function Headline({
  title,
  sub,
  large = false,
}: {
  title: string;
  sub?: string;
  large?: boolean;
}) {
  return (
    <div>
      <h1
        className={
          large
            ? 'font-serif text-4xl leading-tight tracking-tight md:text-5xl'
            : 'font-serif text-2xl leading-tight tracking-tight md:text-3xl'
        }
      >
        {title}
      </h1>
      {sub && (
        <p className="mt-3 text-base italic text-muted-foreground">{sub}</p>
      )}
    </div>
  );
}

/**
 * Wraps an input/textarea row to capture Enter → advance, without leaking the
 * keydown logic into the shared atom. We intercept at the parent so the atom
 * stays dumb.
 */
function KeyCaptureRow({
  children,
  onEnter,
}: {
  children: React.ReactNode;
  onEnter: (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current?.querySelector<
      HTMLInputElement | HTMLTextAreaElement
    >('input, textarea');
    if (!el) return;
    const handler = (ev: Event) => {
      onEnter(ev as unknown as KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>);
    };
    el.addEventListener('keydown', handler);
    return () => el.removeEventListener('keydown', handler);
  }, [onEnter]);
  return useMemo(() => <div ref={ref}>{children}</div>, [children]);
}
