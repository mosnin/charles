'use client';

/**
 * Charles onboarding — 3-step wizard, cofounder.co aesthetic.
 *
 * Step 1 — Company: name, tagline, founder name
 * Step 2 — Idea: what you're building, one-line pitch, target customer
 * Step 3 — GitHub: connect via Composio OAuth, or skip
 *
 * Visuals:
 *  - Sapling mascot top-center (small, ~32px).
 *  - Serif H1 (SERIF_DISPLAY) per step.
 *  - Mono "step n / 3" chip under the sapling.
 *  - Dotted-grid background (.bg-grid).
 *  - Black pill primary, italic muted skip.
 *
 * Form fields + API contract are unchanged. Only visuals + copy moved.
 * On complete: POST /api/onboarding/complete → redirect to /s/{slug}.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ArrowRight, Github, Loader2 } from 'lucide-react';
import { Sapling } from '@/components/canvas/sapling';
import { GridBackground } from '@/components/canvas/grid-background';
import {
  BODY_MUTED,
  MONO_CHIP,
  PRIMARY_PILL,
  SECTION_LABEL,
  SERIF_DISPLAY,
} from '@/lib/typography';
import { cn } from '@/lib/utils';
import {
  STEP_IDS,
  STEP_COPY,
  TOTAL_STEPS,
  stepChip,
  type StepId,
  type FieldCopy,
} from './step-copy';
import { WORKSPACE_TEMPLATES } from '@/lib/workspace-templates/catalog';

// ── Types ──────────────────────────────────────────────────────────────────

interface FormValues {
  companyName: string;
  tagline: string;
  founderName: string;
  whatBuilding: string;
  oneLinePitch: string;
  targetCustomer: string;
  githubConnected: boolean;
  githubSkipped: boolean;
  templateSlug: string; // empty = skipped
}

interface WizardClientProps {
  defaultFounderName?: string;
}

// ── Shared input styling ───────────────────────────────────────────────────

const INPUT_CLASS =
  'w-full h-11 rounded-md border border-border/70 bg-background px-3 text-base text-foreground ' +
  'placeholder:text-muted-foreground/60 outline-none transition-colors ' +
  'focus:border-foreground/40';

const TEXTAREA_CLASS =
  'w-full rounded-md border border-border/70 bg-background px-3 py-2.5 text-base text-foreground ' +
  'placeholder:text-muted-foreground/60 outline-none transition-colors resize-none ' +
  'focus:border-foreground/40';

const LABEL_CLASS = cn(SECTION_LABEL, 'mb-2 block');

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
    templateSlug: '',
  });

  const set = useCallback(
    <K extends keyof FormValues>(key: K, value: FormValues[K]) => {
      setValues((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const stepId: StepId = STEP_IDS[stepIndex];
  const isLastStep = stepIndex === TOTAL_STEPS - 1;

  const goBack = useCallback(() => {
    setStepIndex((i) => Math.max(0, i - 1));
  }, []);

  const finalize = useCallback(async () => {
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

      // Optional template apply — non-fatal. If it fails the founder still
      // lands in a clean workspace; they can pick a template from
      // /s/[slug]/templates later.
      if (values.templateSlug) {
        try {
          await fetch('/api/workspace-templates/apply', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ templateSlug: values.templateSlug }),
          });
        } catch {
          // Swallow — landing in the workspace beats a broken redirect.
        }
      }

      router.push(`/s/${data.slug}`);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Something went wrong. Try again.';
      toast.error(msg);
      setSubmitting(false);
    }
  }, [router, values]);

  const goNext = useCallback(async () => {
    if (!isLastStep) {
      setStepIndex((i) => i + 1);
      return;
    }
    await finalize();
  }, [isLastStep, finalize]);

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

  const step = STEP_COPY[stepId];

  // Field value resolver — keeps render below stateless.
  const fieldValue = (key: string): string => {
    return (values[key as keyof FormValues] as string) ?? '';
  };

  // For the first two steps, "require any" — at least one non-empty field.
  const multiFieldDisabled =
    step.fields !== undefined &&
    !step.fields.some((f) => fieldValue(f.key).trim().length > 0);

  return (
    <main className="relative min-h-screen w-full overflow-hidden bg-background text-foreground">
      <GridBackground />

      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-2xl flex-col items-center px-6 py-16 md:py-24">
        {/* ── Top: sapling + step chip ────────────────────────────── */}
        <div className="flex flex-col items-center gap-3">
          <Sapling size={32} />
          <span className={cn(MONO_CHIP, 'text-muted-foreground')}>
            {stepChip(stepIndex)}
          </span>
        </div>

        {/* ── Headline ──────────────────────────────────────────── */}
        <div className="mt-8 w-full text-center">
          <h1 className={cn(SERIF_DISPLAY, 'text-3xl md:text-4xl')}>
            {step.title}
          </h1>
          <p className={cn(BODY_MUTED, 'mt-3 text-base italic')}>
            {step.subtitle}
          </p>
        </div>

        {/* ── Body ──────────────────────────────────────────────── */}
        <div className="mt-10 w-full max-w-lg">
          {step.fields && (
            <MultiFieldBody
              fields={step.fields}
              fieldValue={fieldValue}
              onChange={(key, value) =>
                set(key as keyof FormValues, value as never)
              }
              onEnter={goNext}
              canSubmit={!multiFieldDisabled}
            />
          )}

          {stepId === 'github' && (
            <GitHubBody
              connected={values.githubConnected}
              connecting={connectingGitHub}
            />
          )}

          {stepId === 'template' && (
            <TemplateBody
              selected={values.templateSlug}
              onSelect={(slug) => set('templateSlug', slug)}
            />
          )}
        </div>

        {/* ── Footer: primary + skip ────────────────────────────── */}
        <div className="mt-10 flex w-full max-w-lg flex-col items-center gap-4">
          {stepId !== 'github' && stepId !== 'template' && (
            <button
              type="button"
              onClick={goNext}
              disabled={multiFieldDisabled || submitting}
              className={cn(
                PRIMARY_PILL,
                'h-11 px-7',
                'disabled:cursor-not-allowed disabled:opacity-40',
              )}
            >
              Next
              <ArrowRight size={14} />
            </button>
          )}

          {stepId === 'template' && (
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  set('templateSlug', '');
                  void finalize();
                }}
                disabled={submitting}
                className="text-sm italic text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
              >
                Skip — I&apos;ll set it up myself
              </button>
              <button
                type="button"
                onClick={goNext}
                disabled={submitting || !values.templateSlug}
                className={cn(
                  PRIMARY_PILL,
                  'h-11 px-7',
                  'disabled:cursor-not-allowed disabled:opacity-40',
                )}
              >
                {submitting ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : null}
                {submitting ? 'Finishing' : 'Apply and finish'}
              </button>
            </div>
          )}

          {stepId === 'github' && (
            <div className="flex items-center gap-3">
              {!values.githubConnected && (
                <button
                  type="button"
                  onClick={() => {
                    set('githubSkipped', true);
                    goNext();
                  }}
                  disabled={submitting || connectingGitHub}
                  className="text-sm italic text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
                >
                  Skip for now
                </button>
              )}
              <button
                type="button"
                onClick={values.githubConnected ? goNext : connectGitHub}
                disabled={connectingGitHub || submitting}
                className={cn(
                  PRIMARY_PILL,
                  'h-11 px-7',
                  'disabled:cursor-not-allowed disabled:opacity-40',
                )}
              >
                {connectingGitHub || submitting ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : values.githubConnected ? (
                  <ArrowRight size={14} />
                ) : (
                  <Github size={14} />
                )}
                {values.githubConnected
                  ? 'Finish setup'
                  : connectingGitHub
                    ? 'Connecting'
                    : 'Connect GitHub'}
              </button>
            </div>
          )}

          {stepIndex > 0 && !submitting && (
            <button
              type="button"
              onClick={goBack}
              className="text-sm italic text-muted-foreground transition-colors hover:text-foreground"
            >
              Back
            </button>
          )}
        </div>
      </div>
    </main>
  );
}

// ── Bodies ─────────────────────────────────────────────────────────────────

interface MultiFieldBodyProps {
  fields: FieldCopy[];
  fieldValue: (key: string) => string;
  onChange: (key: string, value: string) => void;
  onEnter: () => void;
  canSubmit: boolean;
}

function MultiFieldBody({
  fields,
  fieldValue,
  onChange,
  onEnter,
  canSubmit,
}: MultiFieldBodyProps) {
  // Focus the first input/textarea when the step mounts. Querying the DOM
  // avoids juggling multiple refs across a union of element types.
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = containerRef.current?.querySelector<
      HTMLInputElement | HTMLTextAreaElement
    >('input, textarea');
    el?.focus();
  }, [fields]);

  return (
    <div ref={containerRef} className="space-y-4 text-left">
      {fields.map((f, i) => (
        <div key={f.key}>
          <label className={LABEL_CLASS}>{f.label}</label>
          {f.multiline ? (
            <textarea
              value={fieldValue(f.key)}
              onChange={(e) => onChange(f.key, e.target.value)}
              placeholder={f.placeholder}
              maxLength={f.maxLength}
              rows={f.rows ?? 3}
              className={TEXTAREA_CLASS}
            />
          ) : (
            <input
              type="text"
              value={fieldValue(f.key)}
              onChange={(e) => onChange(f.key, e.target.value)}
              onKeyDown={(e) => {
                if (
                  e.key === 'Enter' &&
                  i === fields.length - 1 &&
                  canSubmit
                ) {
                  e.preventDefault();
                  onEnter();
                }
              }}
              placeholder={f.placeholder}
              maxLength={f.maxLength}
              className={INPUT_CLASS}
            />
          )}
        </div>
      ))}
    </div>
  );
}

interface GitHubBodyProps {
  connected: boolean;
  connecting: boolean;
}

interface TemplateBodyProps {
  selected: string;
  onSelect: (slug: string) => void;
}

function TemplateBody({ selected, onSelect }: TemplateBodyProps) {
  return (
    <div className="grid gap-2.5">
      {WORKSPACE_TEMPLATES.map((t) => {
        const isSelected = selected === t.slug;
        return (
          <button
            key={t.slug}
            type="button"
            onClick={() => onSelect(t.slug)}
            className={cn(
              'group rounded-xl border bg-background p-4 text-left transition-colors',
              isSelected
                ? 'border-foreground/60 ring-2 ring-foreground/20'
                : 'border-border/70 hover:border-foreground/30',
            )}
          >
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-serif text-base font-medium">{t.name}</span>
              <span className={cn(BODY_MUTED, 'shrink-0 text-xs')}>
                {isSelected ? 'Selected' : ''}
              </span>
            </div>
            <p className={cn(BODY_MUTED, 'mt-1 text-sm')}>{t.blurb}</p>
          </button>
        );
      })}
    </div>
  );
}

function GitHubBody({ connected, connecting }: GitHubBodyProps) {
  return (
    <div className="mx-auto flex max-w-sm flex-col items-center gap-6">
      <div
        className={cn(
          'flex h-16 w-16 items-center justify-center rounded-2xl border',
          connected
            ? 'border-foreground/30 bg-foreground text-background'
            : 'border-border/70 bg-background text-muted-foreground',
        )}
      >
        {connecting ? (
          <Loader2 size={28} className="animate-spin" />
        ) : (
          <Github size={28} />
        )}
      </div>

      {connected ? (
        <p className={cn(BODY_MUTED, 'text-center text-sm')}>
          GitHub connected. Charles can now open PRs and push code.
        </p>
      ) : (
        <ul className="w-full space-y-2 text-left text-sm text-muted-foreground">
          <li className="flex items-start gap-2">
            <span className="mt-0.5 text-foreground/40">—</span>
            Scaffold new repos from a brief.
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-0.5 text-foreground/40">—</span>
            Open pull requests and review diffs.
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-0.5 text-foreground/40">—</span>
            Ship code without context-switching.
          </li>
        </ul>
      )}
    </div>
  );
}
