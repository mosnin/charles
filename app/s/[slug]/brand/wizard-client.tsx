'use client';

/**
 * Brand Builder — 4-step guided wizard.
 *
 * Step 1 — Voice       Pick 2-3 descriptors, optional sentences.
 * Step 2 — Palette     Primary color + mood. Neutrals are derived.
 * Step 3 — Typography  Pick a pairing.
 * Step 4 — Logo        Generate a starting mark, then save.
 *
 * Subtractive on purpose. No mood boards, no inspirations carousel, no
 * upload-your-references — those are configuration disguised as features.
 * Pick the one thing on each screen the founder needs to decide.
 *
 * The output: a brand-kit.md a designer could hand off in five minutes.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ArrowRight, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  BODY_MUTED,
  GHOST_PILL,
  PRIMARY_PILL,
  SECTION_LABEL,
  TITLE_FONT,
} from '@/lib/typography';
import {
  buildBrandKitMarkdown,
  type BrandMood,
  type BrandKitInput,
} from '@/lib/documents/brand-markdown-builder';

// ── Constants — curated, capped, opinionated ──────────────────────────────

const VOICE_OPTIONS = [
  'Confident',
  'Calm',
  'Bold',
  'Quiet',
  'Direct',
  'Warm',
  'Playful',
  'Technical',
  'Friendly',
  'Editorial',
] as const;
type VoiceOption = typeof VOICE_OPTIONS[number];

const MOOD_OPTIONS: { value: BrandMood; label: string; sub: string }[] = [
  { value: 'editorial', label: 'Editorial', sub: 'White, black, tiny color.' },
  { value: 'confident', label: 'Confident', sub: 'Black, bold color, white.' },
  { value: 'quiet', label: 'Quiet', sub: 'Off-white, warm grays, muted color.' },
];

const TYPE_PRESETS = [
  {
    id: 'editorial',
    label: 'Editorial',
    heading: 'Tiempos Headline',
    body: 'Inter',
    headingStack: '"Tiempos Headline", Georgia, "Times New Roman", serif',
    bodyStack: 'Inter, system-ui, sans-serif',
  },
  {
    id: 'modern',
    label: 'Modern',
    heading: 'Inter Display',
    body: 'Inter',
    headingStack: '"Inter Display", Inter, system-ui, sans-serif',
    bodyStack: 'Inter, system-ui, sans-serif',
  },
  {
    id: 'confident',
    label: 'Confident',
    heading: 'Söhne',
    body: 'Inter',
    headingStack: 'Söhne, "Helvetica Neue", Arial, sans-serif',
    bodyStack: 'Inter, system-ui, sans-serif',
  },
] as const;
type TypePresetId = typeof TYPE_PRESETS[number]['id'];

const MAX_GENERATIONS = 3;

// ── Color helpers — pure HSL math, no library ─────────────────────────────

function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const clean = hex.replace('#', '');
  const full =
    clean.length === 3
      ? clean.split('').map((c) => c + c).join('')
      : clean;
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s, l };
}

function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) { r = c; g = x; b = 0; }
  else if (h < 120) { r = x; g = c; b = 0; }
  else if (h < 180) { r = 0; g = c; b = x; }
  else if (h < 240) { r = 0; g = x; b = c; }
  else if (h < 300) { r = x; g = 0; b = c; }
  else { r = c; g = 0; b = x; }
  const toHex = (v: number) => {
    const n = Math.round((v + m) * 255);
    return n.toString(16).padStart(2, '0');
  };
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Mood-aware neutral derivation. Same primary hue, four steps tuned per
 * mood. This is "configuration is failure to decide" — the founder does
 * not get to pick the off-white or the gray. We pick.
 */
function deriveNeutrals(
  primaryHex: string,
  mood: BrandMood,
): { name: string; hex: string }[] {
  const { h } = hexToHsl(primaryHex);
  // Tiny hint of the primary hue in the neutrals, so they don't look stock.
  const tintS = mood === 'quiet' ? 0.06 : 0.02;
  if (mood === 'editorial') {
    return [
      { name: 'White', hex: '#ffffff' },
      { name: 'Light gray', hex: hslToHex(h, tintS, 0.96) },
      { name: 'Dark gray', hex: hslToHex(h, tintS, 0.32) },
      { name: 'Black', hex: '#0a0a0a' },
    ];
  }
  if (mood === 'confident') {
    return [
      { name: 'White', hex: '#ffffff' },
      { name: 'Light gray', hex: hslToHex(h, tintS, 0.94) },
      { name: 'Dark gray', hex: hslToHex(h, tintS, 0.22) },
      { name: 'Black', hex: '#000000' },
    ];
  }
  // quiet — warm off-white, warmer grays
  return [
    { name: 'Off-white', hex: hslToHex(h, 0.1, 0.97) },
    { name: 'Warm light', hex: hslToHex(h, 0.08, 0.9) },
    { name: 'Warm dark', hex: hslToHex(h, 0.08, 0.36) },
    { name: 'Ink', hex: hslToHex(h, 0.04, 0.14) },
  ];
}

// ── Local UI atoms — kept inline because they're step-specific ────────────

function Chip({
  label,
  selected,
  disabled,
  onClick,
}: {
  label: string;
  selected: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled && !selected}
      className={cn(
        'inline-flex h-9 items-center rounded-full border px-4 text-sm font-medium transition-colors duration-150',
        selected
          ? 'border-foreground bg-foreground text-background'
          : disabled
            ? 'border-border/50 bg-background text-muted-foreground/40 cursor-not-allowed'
            : 'border-border/70 bg-background text-foreground hover:bg-foreground/[0.04]',
      )}
    >
      {label}
    </button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="text-left">
      <label className={cn(SECTION_LABEL, 'mb-2 block')}>{label}</label>
      {children}
    </div>
  );
}

const INPUT_CLASS =
  'w-full h-10 rounded-md border border-border/70 bg-background px-3 text-sm text-foreground ' +
  'placeholder:text-muted-foreground/60 outline-none transition-colors focus:border-foreground/30';

// ── Types ─────────────────────────────────────────────────────────────────

interface WizardState {
  descriptors: VoiceOption[];
  loved: string;
  banned: string;
  primary: string;
  mood: BrandMood;
  typePreset: TypePresetId;
  logoPrompt: string;
  logoUrl: string | null;
  generationsUsed: number;
}

interface BrandWizardClientProps {
  slug: string;
  companyName: string;
}

// ── Wizard ────────────────────────────────────────────────────────────────

export function BrandWizardClient({ slug, companyName }: BrandWizardClientProps) {
  const router = useRouter();
  const [stepIndex, setStepIndex] = useState(0);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);

  const [state, setState] = useState<WizardState>({
    descriptors: [],
    loved: '',
    banned: '',
    primary: '#0A0A0F',
    mood: 'editorial',
    typePreset: 'editorial',
    logoPrompt: '',
    logoUrl: null,
    generationsUsed: 0,
  });

  const set = useCallback(<K extends keyof WizardState>(key: K, value: WizardState[K]) => {
    setState((s) => ({ ...s, [key]: value }));
  }, []);

  const neutrals = useMemo(
    () => deriveNeutrals(state.primary, state.mood),
    [state.primary, state.mood],
  );

  const preset = useMemo(
    () => TYPE_PRESETS.find((p) => p.id === state.typePreset)!,
    [state.typePreset],
  );

  // Suggested logo prompt — refreshes when voice descriptors change, unless
  // the founder has already edited it.
  const promptDirty = useRef(false);
  useEffect(() => {
    if (promptDirty.current) return;
    const voice = state.descriptors.length
      ? state.descriptors.join(', ').toLowerCase()
      : 'minimal, confident';
    const name = companyName.trim() || 'the company';
    set(
      'logoPrompt',
      `A minimal mark for ${name}. ${voice}. Black on white, single weight, no gradient.`,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.descriptors, companyName]);

  // Build the payload + markdown preview.
  const input: BrandKitInput = useMemo(
    () => ({
      voice: {
        descriptors: state.descriptors,
        loved: state.loved.trim() || undefined,
        banned: state.banned.trim() || undefined,
      },
      palette: {
        primary: state.primary,
        mood: state.mood,
        neutrals,
      },
      typography: {
        preset: preset.label,
        heading: preset.heading,
        body: preset.body,
      },
      logo: {
        prompt: state.logoPrompt,
        url: state.logoUrl ?? undefined,
      },
    }),
    [state, neutrals, preset],
  );

  const markdown = useMemo(() => buildBrandKitMarkdown(input), [input]);

  // ── Step gates ────────────────────────────────────────────────────────
  const canAdvance = useMemo(() => {
    if (stepIndex === 0) return state.descriptors.length >= 2;
    if (stepIndex === 1) return /^#[0-9a-fA-F]{6}$/.test(state.primary);
    if (stepIndex === 2) return !!state.typePreset;
    if (stepIndex === 3) return state.logoPrompt.trim().length > 0;
    return true;
  }, [stepIndex, state]);

  const isLast = stepIndex === 3;

  const goBack = useCallback(() => {
    setStepIndex((i) => Math.max(0, i - 1));
  }, []);

  const goNext = useCallback(() => {
    if (!canAdvance) return;
    setStepIndex((i) => Math.min(3, i + 1));
  }, [canAdvance]);

  const save = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    try {
      const res = await fetch('/api/brand/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data?.error ?? `Save failed (${res.status}).`);
        setSaving(false);
        return;
      }
      router.push(data.redirectTo ?? `/s/${slug}/documents/brand-kit?mode=edit`);
    } catch {
      toast.error('Network error. Try again.');
      setSaving(false);
    }
  }, [saving, input, router, slug]);

  const skip = useCallback(() => {
    void save();
  }, [save]);

  const generateLogo = useCallback(async () => {
    if (generating) return;
    if (state.generationsUsed >= MAX_GENERATIONS) {
      toast.error('Three generations is the cap. Save what you have.');
      return;
    }
    setGenerating(true);
    try {
      const res = await fetch('/api/brand/generate-logo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: state.logoPrompt }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data?.error ?? 'Could not generate. Try again.');
        return;
      }
      set('logoUrl', data.url ?? null);
      set('generationsUsed', state.generationsUsed + 1);
    } catch {
      toast.error('Network error. Try again.');
    } finally {
      setGenerating(false);
    }
  }, [generating, state.logoPrompt, state.generationsUsed, set]);

  // Cmd+Enter to advance, Esc to exit
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        if (isLast) {
          void save();
        } else if (canAdvance) {
          goNext();
        }
      } else if (e.key === 'Escape') {
        router.push(`/s/${slug}`);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isLast, canAdvance, goNext, save, router, slug]);

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <div className="relative min-h-screen w-full bg-background text-foreground">
      {/* Top bar */}
      <div className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-border/70 bg-background/80 px-6 backdrop-blur">
        <button
          type="button"
          onClick={() => router.push(`/s/${slug}`)}
          className={cn(GHOST_PILL, 'h-8 px-3 text-xs')}
        >
          Exit
        </button>
        <span className={cn(SECTION_LABEL)}>Brand kit</span>
        <button
          type="button"
          onClick={skip}
          disabled={saving}
          className={cn(GHOST_PILL, 'h-8 px-3 text-xs')}
        >
          {saving ? 'Saving…' : 'Skip and save what I have'}
        </button>
      </div>

      {/* Progress */}
      <div className="flex justify-center pt-10">
        <div className="flex items-center gap-1.5">
          {[0, 1, 2, 3].map((i) => (
            <span
              key={i}
              className={cn(
                'inline-block h-1.5 rounded-full transition-all duration-200',
                i === stepIndex
                  ? 'w-7 bg-foreground'
                  : i < stepIndex
                    ? 'w-1.5 bg-foreground/40'
                    : 'w-1.5 bg-foreground/15',
              )}
            />
          ))}
        </div>
      </div>

      {/* Step content */}
      <div className="mx-auto w-full max-w-[600px] px-6 pb-32 pt-12">
        {stepIndex === 0 && (
          <StepVoice
            descriptors={state.descriptors}
            loved={state.loved}
            banned={state.banned}
            onToggle={(d) => {
              const has = state.descriptors.includes(d);
              if (has) {
                set('descriptors', state.descriptors.filter((x) => x !== d));
              } else if (state.descriptors.length < 3) {
                set('descriptors', [...state.descriptors, d]);
              }
            }}
            setLoved={(v) => set('loved', v)}
            setBanned={(v) => set('banned', v)}
          />
        )}

        {stepIndex === 1 && (
          <StepPalette
            primary={state.primary}
            mood={state.mood}
            neutrals={neutrals}
            setPrimary={(v) => set('primary', v)}
            setMood={(v) => set('mood', v)}
          />
        )}

        {stepIndex === 2 && (
          <StepTypography
            preset={state.typePreset}
            companyName={companyName || 'Your company name.'}
            setPreset={(v) => set('typePreset', v)}
          />
        )}

        {stepIndex === 3 && (
          <StepLogo
            prompt={state.logoPrompt}
            logoUrl={state.logoUrl}
            generating={generating}
            generationsUsed={state.generationsUsed}
            onPromptChange={(v) => {
              promptDirty.current = true;
              set('logoPrompt', v);
            }}
            onGenerate={generateLogo}
            markdown={markdown}
          />
        )}
      </div>

      {/* Bottom action bar */}
      <div className="fixed bottom-0 left-0 right-0 z-10 border-t border-border/70 bg-background/90 px-6 py-4 backdrop-blur">
        <div className="mx-auto flex w-full max-w-[600px] items-center justify-between">
          <button
            type="button"
            onClick={goBack}
            disabled={stepIndex === 0}
            className={cn(GHOST_PILL, 'h-9 px-4', stepIndex === 0 && 'invisible')}
          >
            Back
          </button>
          <span className="text-xs text-muted-foreground">
            Step {stepIndex + 1} of 4
          </span>
          {isLast ? (
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className={cn(PRIMARY_PILL, 'h-9 px-5', saving && 'opacity-60')}
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : null}
              Save to Brand kit
            </button>
          ) : (
            <button
              type="button"
              onClick={goNext}
              disabled={!canAdvance}
              className={cn(
                PRIMARY_PILL,
                'h-9 px-5',
                !canAdvance && 'cursor-not-allowed opacity-40',
              )}
            >
              Next
              <ArrowRight size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Step 1: Voice ─────────────────────────────────────────────────────────

function StepVoice({
  descriptors,
  loved,
  banned,
  onToggle,
  setLoved,
  setBanned,
}: {
  descriptors: VoiceOption[];
  loved: string;
  banned: string;
  onToggle: (d: VoiceOption) => void;
  setLoved: (v: string) => void;
  setBanned: (v: string) => void;
}) {
  const max = descriptors.length >= 3;
  return (
    <div className="space-y-8">
      <header className="text-center">
        <h1 className="text-3xl tracking-tight text-foreground" style={TITLE_FONT}>
          Say what you sound like.
        </h1>
        <p className={cn(BODY_MUTED, 'mt-3')}>
          Pick two or three. Three is the ceiling.
        </p>
      </header>

      <div className="flex flex-wrap justify-center gap-2">
        {VOICE_OPTIONS.map((d) => (
          <Chip
            key={d}
            label={d}
            selected={descriptors.includes(d)}
            disabled={max}
            onClick={() => onToggle(d)}
          />
        ))}
      </div>

      <div className="space-y-4">
        <Field label="A sentence we love (optional)">
          <input
            type="text"
            value={loved}
            onChange={(e) => setLoved(e.target.value)}
            placeholder="One line that captures the brand."
            maxLength={160}
            className={INPUT_CLASS}
          />
        </Field>
        <Field label="A sentence we'd never write (optional)">
          <input
            type="text"
            value={banned}
            onChange={(e) => setBanned(e.target.value)}
            placeholder="One line you reject. A banlist seed."
            maxLength={160}
            className={INPUT_CLASS}
          />
        </Field>
      </div>
    </div>
  );
}

// ── Step 2: Palette ───────────────────────────────────────────────────────

function StepPalette({
  primary,
  mood,
  neutrals,
  setPrimary,
  setMood,
}: {
  primary: string;
  mood: BrandMood;
  neutrals: { name: string; hex: string }[];
  setPrimary: (v: string) => void;
  setMood: (v: BrandMood) => void;
}) {
  return (
    <div className="space-y-8">
      <header className="text-center">
        <h1 className="text-3xl tracking-tight text-foreground" style={TITLE_FONT}>
          Pick your colors.
        </h1>
        <p className={cn(BODY_MUTED, 'mt-3')}>
          One ink that says &ldquo;us&rdquo;. The rest is decided for you.
        </p>
      </header>

      <Field label="Primary">
        <div className="flex items-center gap-3">
          <input
            type="color"
            value={primary}
            onChange={(e) => setPrimary(e.target.value)}
            className="h-12 w-12 cursor-pointer rounded-md border border-border/70 bg-background"
            aria-label="Primary color"
          />
          <input
            type="text"
            value={primary}
            onChange={(e) => {
              const v = e.target.value.trim();
              if (/^#?[0-9a-fA-F]{0,6}$/.test(v)) {
                setPrimary(v.startsWith('#') ? v : `#${v}`);
              }
            }}
            className={cn(INPUT_CLASS, 'flex-1 font-mono')}
            maxLength={7}
          />
        </div>
      </Field>

      <Field label="Mood">
        <div className="grid gap-2">
          {MOOD_OPTIONS.map((m) => (
            <button
              key={m.value}
              type="button"
              onClick={() => setMood(m.value)}
              className={cn(
                'flex items-center justify-between rounded-md border px-4 py-3 text-left transition-colors duration-150',
                mood === m.value
                  ? 'border-foreground bg-foreground/[0.04]'
                  : 'border-border/70 bg-background hover:bg-foreground/[0.02]',
              )}
            >
              <div>
                <div className="text-sm font-medium text-foreground">{m.label}</div>
                <div className="text-xs text-muted-foreground">{m.sub}</div>
              </div>
              <span
                className={cn(
                  'inline-block h-3 w-3 rounded-full border',
                  mood === m.value ? 'border-foreground bg-foreground' : 'border-border',
                )}
              />
            </button>
          ))}
        </div>
      </Field>

      <Field label="Neutrals">
        <div className="grid grid-cols-4 gap-2">
          {neutrals.map((n) => (
            <div key={n.name} className="flex flex-col gap-1.5">
              <div
                className="h-16 w-full rounded-md border border-border/70"
                style={{ backgroundColor: n.hex }}
              />
              <div className="text-[11px] font-medium text-foreground">{n.name}</div>
              <div className="text-[10px] font-mono text-muted-foreground">{n.hex}</div>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Neutrals are derived from the mood. You don&rsquo;t pick them.
        </p>
      </Field>
    </div>
  );
}

// ── Step 3: Typography ────────────────────────────────────────────────────

function StepTypography({
  preset,
  companyName,
  setPreset,
}: {
  preset: TypePresetId;
  companyName: string;
  setPreset: (v: TypePresetId) => void;
}) {
  return (
    <div className="space-y-8">
      <header className="text-center">
        <h1 className="text-3xl tracking-tight text-foreground" style={TITLE_FONT}>
          Pick your faces.
        </h1>
        <p className={cn(BODY_MUTED, 'mt-3')}>
          One heading, one body. That&rsquo;s the pairing.
        </p>
      </header>

      <div className="space-y-3">
        {TYPE_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setPreset(p.id)}
            className={cn(
              'block w-full rounded-md border p-5 text-left transition-colors duration-150',
              preset === p.id
                ? 'border-foreground bg-foreground/[0.04]'
                : 'border-border/70 bg-background hover:bg-foreground/[0.02]',
            )}
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-foreground">{p.label}</span>
              <span className="text-xs text-muted-foreground">
                {p.heading} + {p.body}
              </span>
            </div>
            <div
              className="mt-3 text-2xl text-foreground"
              style={{ fontFamily: p.headingStack }}
            >
              {companyName}
            </div>
            <div
              className="mt-1 text-sm text-muted-foreground"
              style={{ fontFamily: p.bodyStack }}
            >
              We ship. We decide. We send.
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Step 4: Logo + preview ────────────────────────────────────────────────

function StepLogo({
  prompt,
  logoUrl,
  generating,
  generationsUsed,
  onPromptChange,
  onGenerate,
  markdown,
}: {
  prompt: string;
  logoUrl: string | null;
  generating: boolean;
  generationsUsed: number;
  onPromptChange: (v: string) => void;
  onGenerate: () => void;
  markdown: string;
}) {
  const remaining = MAX_GENERATIONS - generationsUsed;
  return (
    <div className="space-y-8">
      <header className="text-center">
        <h1 className="text-3xl tracking-tight text-foreground" style={TITLE_FONT}>
          Make a starting mark.
        </h1>
        <p className={cn(BODY_MUTED, 'mt-3')}>
          Describe it in one line. Keep it small.
        </p>
      </header>

      <Field label="Prompt">
        <textarea
          value={prompt}
          onChange={(e) => onPromptChange(e.target.value)}
          rows={3}
          maxLength={400}
          className={cn(
            'w-full resize-none rounded-md border border-border/70 bg-background px-3 py-2.5 text-sm text-foreground outline-none transition-colors focus:border-foreground/30',
          )}
        />
      </Field>

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onGenerate}
          disabled={generating || remaining <= 0 || prompt.trim().length === 0}
          className={cn(PRIMARY_PILL, 'h-9 px-4', (generating || remaining <= 0) && 'opacity-60')}
        >
          {generating ? <Loader2 size={14} className="animate-spin" /> : null}
          {logoUrl ? 'Regenerate' : 'Generate'}
        </button>
        <span className="text-xs text-muted-foreground">
          {remaining > 0 ? `${remaining} left` : 'Cap reached'}
        </span>
      </div>

      {logoUrl && (
        <div className="flex flex-col items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={logoUrl}
            alt="Logo preview"
            className="h-48 w-48 rounded-md border border-border/70 object-contain"
          />
          <span className="text-xs text-muted-foreground">
            A starting mark. Hand it to a designer.
          </span>
        </div>
      )}

      <details className="rounded-md border border-border/70 bg-background">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-foreground">
          Preview the brand kit
        </summary>
        <pre className="overflow-auto border-t border-border/70 px-4 py-3 text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap font-mono">
          {markdown}
        </pre>
      </details>
    </div>
  );
}
