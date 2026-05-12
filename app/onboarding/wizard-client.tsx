'use client';

/**
 * Charles onboarding — 3-step wizard.
 *
 * Step 1 — Company: name, tagline, founder name
 * Step 2 — Idea: what you're building, one-line pitch, target customer
 * Step 3 — GitHub: connect via Composio OAuth, or skip
 *
 * On complete: POST /api/onboarding/complete → redirect to /s/{slug}
 */

import { useCallback, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Github, Loader2 } from 'lucide-react';
import { OnboardingShell } from '@/components/onboarding/onboarding-shell';
import {
  MultiFieldStep,
  StepScaffold,
  TextareaStep,
} from '@/components/onboarding/onboarding-steps';

// ── Types ──────────────────────────────────────────────────────────────────

type StepId = 'company' | 'idea' | 'github';

const STEPS: StepId[] = ['company', 'idea', 'github'];

interface FormValues {
  // Step 1
  companyName: string;
  tagline: string;
  founderName: string;
  // Step 2
  whatBuilding: string;
  oneLinePitch: string;
  targetCustomer: string;
  // Step 3
  githubConnected: boolean;
  githubSkipped: boolean;
}

interface WizardClientProps {
  defaultFounderName?: string;
}

// ── Component ──────────────────────────────────────────────────────────────

export function WizardClient({ defaultFounderName = '' }: WizardClientProps) {
  const router = useRouter();

  const [stepIndex, setStepIndex] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [connectingGitHub, setConnectingGitHub] = useState(false);

  const [values, setValues] = useState<FormValues>({
    companyName: '',
    tagline: '',
    founderName: defaultFounderName,
    whatBuilding: '',
    oneLinePitch: '',
    targetCustomer: '',
    githubConnected: false,
    githubSkipped: false,
  });

  const set = useCallback(
    <K extends keyof FormValues>(key: K, value: FormValues[K]) => {
      setValues((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const stepId = STEPS[stepIndex];
  const isLastStep = stepIndex === STEPS.length - 1;

  const goBack = useCallback(() => {
    setStepIndex((i) => Math.max(0, i - 1));
  }, []);

  const goNext = useCallback(async () => {
    if (!isLastStep) {
      setStepIndex((i) => i + 1);
      return;
    }
    await finalize();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLastStep]);

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
        // OAuth redirect — the user returns post-auth; we set githubConnected
        // as a best-effort flag before redirect.
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

  async function finalize() {
    setSubmitting(true);
    try {
      const res = await fetch('/api/onboarding/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyName: values.companyName.trim(),
          tagline: values.tagline.trim(),
          founderName: values.founderName.trim(),
          whatBuilding: values.whatBuilding.trim(),
          oneLinePitch: values.oneLinePitch.trim(),
          targetCustomer: values.targetCustomer.trim(),
          githubConnected: values.githubConnected,
          githubSkipped: values.githubSkipped,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error ?? `Request failed (${res.status})`);
      }
      router.push(`/s/${data.slug}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Something went wrong. Try again.';
      toast.error(msg);
      setSubmitting(false);
    }
  }

  return (
    <OnboardingShell
      stepIndex={stepIndex}
      totalSteps={STEPS.length}
      stepKey={stepId}
      onBack={stepIndex > 0 && !submitting ? goBack : undefined}
    >
      {/* ── Step 1: Company ──────────────────────────────────────────── */}
      {stepId === 'company' && (
        <MultiFieldStep
          title="What are you building?"
          subtitle="Start with a name. Everything else can be refined later."
          fields={[
            {
              key: 'companyName',
              label: 'Company name',
              placeholder: 'Acme',
              value: values.companyName,
              onChange: (v) => set('companyName', v),
              maxLength: 120,
            },
            {
              key: 'tagline',
              label: 'Tagline',
              placeholder: 'One sentence that says what you build',
              value: values.tagline,
              onChange: (v) => set('tagline', v),
              maxLength: 200,
            },
            {
              key: 'founderName',
              label: 'Your name',
              placeholder: 'Alex Kim',
              value: values.founderName,
              onChange: (v) => set('founderName', v),
              maxLength: 120,
            },
          ]}
          onNext={goNext}
          requireAny
        />
      )}

      {/* ── Step 2: Idea ─────────────────────────────────────────────── */}
      {stepId === 'idea' && (
        <MultiFieldStep
          title="Tell Charles about the idea"
          subtitle="Be specific. Charles uses this to scope work for you."
          fields={[
            {
              key: 'whatBuilding',
              label: 'What are you building?',
              placeholder: '2–3 sentences. What does it do and why does it matter?',
              value: values.whatBuilding,
              onChange: (v) => set('whatBuilding', v),
              maxLength: 800,
              multiline: true,
              rows: 3,
            },
            {
              key: 'oneLinePitch',
              label: 'One-line pitch',
              placeholder: 'What does it do, for whom?',
              value: values.oneLinePitch,
              onChange: (v) => set('oneLinePitch', v),
              maxLength: 200,
            },
            {
              key: 'targetCustomer',
              label: 'Target customer',
              placeholder: 'Who has the problem you are solving?',
              value: values.targetCustomer,
              onChange: (v) => set('targetCustomer', v),
              maxLength: 200,
            },
          ]}
          onNext={goNext}
          requireAny
        />
      )}

      {/* ── Step 3: GitHub ───────────────────────────────────────────── */}
      {stepId === 'github' && (
        <GitHubStep
          connected={values.githubConnected}
          onConnect={connectGitHub}
          connectingGitHub={connectingGitHub}
          onSkip={() => {
            set('githubSkipped', true);
            goNext();
          }}
          onFinish={goNext}
          submitting={submitting}
        />
      )}
    </OnboardingShell>
  );
}

// ── GitHub step ────────────────────────────────────────────────────────────

interface GitHubStepProps {
  connected: boolean;
  onConnect: () => void;
  connectingGitHub: boolean;
  onSkip: () => void;
  onFinish: () => void;
  submitting: boolean;
}

function GitHubStep({
  connected,
  onConnect,
  connectingGitHub,
  onSkip,
  onFinish,
  submitting,
}: GitHubStepProps) {
  return (
    <StepScaffold
      title="Connect GitHub"
      subtitle="Charles needs GitHub to scaffold repos, open PRs, and ship code on your behalf."
      onPrimary={connected ? onFinish : onConnect}
      primaryLabel={
        connected ? 'Continue' : connectingGitHub ? 'Connecting…' : 'Connect GitHub'
      }
      primaryBusy={connectingGitHub || (connected && submitting)}
      onSkip={!connected ? onSkip : undefined}
    >
      <div className="mx-auto flex max-w-sm flex-col items-center gap-6">
        {/* GitHub icon */}
        <div
          className={
            connected
              ? 'flex h-16 w-16 items-center justify-center rounded-2xl bg-foreground text-background'
              : 'flex h-16 w-16 items-center justify-center rounded-2xl border border-border/70 bg-background text-muted-foreground'
          }
        >
          {connected ? (
            <Github size={28} />
          ) : (
            <Github size={28} />
          )}
        </div>

        {connected ? (
          <p className="text-sm text-muted-foreground">
            GitHub connected. Charles can now open PRs and push code.
          </p>
        ) : (
          <ul className="w-full space-y-2 text-left text-sm text-muted-foreground">
            <li className="flex items-start gap-2">
              <span className="mt-0.5 text-foreground/40">—</span>
              Scaffold new repos from a brief
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-0.5 text-foreground/40">—</span>
              Open pull requests and review diffs
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-0.5 text-foreground/40">—</span>
              Ship code without context-switching
            </li>
          </ul>
        )}
      </div>
    </StepScaffold>
  );
}
