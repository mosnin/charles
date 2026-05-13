'use client';

/**
 * The Custom Agent Workflow Builder.
 *
 * Left pane: name + custom instructions, autosaved 800ms after blur.
 * Right pane: trigger pill → main agent node → row of subagent nodes,
 * tied together with dashed connectors. Click a subagent to expand its
 * editor inline (instructions + tools). Below the graph: a row of icons
 * for the workspace's active integration toolkits.
 *
 * The screen does ONE job: define what this agent is and who it dispatches.
 * No autonomy slider, no model picker, no tag manager. Those don't belong
 * here. Each control on the page earns its place.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ChevronDown,
  ChevronUp,
  Plus,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  BODY,
  BODY_MUTED,
  CAPTION,
  SERIF_CARD,
  SERIF_DISPLAY,
  MONO_CHIP,
} from '@/lib/typography';
import {
  SUBAGENT_ROLES,
  TRIGGER_TYPES,
  type SubAgentRole,
  type TriggerType,
} from '@/lib/agent-templates/catalog';

interface TemplateInit {
  id: string;
  name: string;
  triggerType: TriggerType;
  customInstructions: string;
}

interface SubAgent {
  id: string;
  name: string;
  role: SubAgentRole;
  instructions: string;
  tools: string[];
  order: number;
}

interface Toolkit {
  toolkit: string;
  name: string;
}

interface Props {
  spaceSlug: string;
  template: TemplateInit;
  subagents: SubAgent[];
  connectedToolkits: Toolkit[];
  allToolNames: string[];
}

const AUTOSAVE_MS = 800;
const MAX_TOOLKIT_ICONS = 8;

export function TemplateBuilder({
  spaceSlug,
  template: initial,
  subagents: initialSubs,
  connectedToolkits,
  allToolNames,
}: Props) {
  const router = useRouter();
  const [name, setName] = useState(initial.name);
  const [triggerType, setTriggerType] = useState<TriggerType>(initial.triggerType);
  const [instructions, setInstructions] = useState(initial.customInstructions);
  const [subagents, setSubagents] = useState<SubAgent[]>(initialSubs);
  const [editingSubId, setEditingSubId] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  const debouncerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const patchTemplate = useCallback(
    async (patch: Partial<Pick<TemplateInit, 'name' | 'triggerType' | 'customInstructions'>>) => {
      setSaveStatus('saving');
      try {
        const res = await fetch(`/api/agent-templates/${initial.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(patch),
        });
        setSaveStatus(res.ok ? 'saved' : 'error');
      } catch {
        setSaveStatus('error');
      }
    },
    [initial.id],
  );

  // Debounced autosave of name + instructions. Trigger picks save immediately.
  useEffect(() => {
    if (debouncerRef.current) clearTimeout(debouncerRef.current);
    if (name === initial.name && instructions === initial.customInstructions) return;
    debouncerRef.current = setTimeout(() => {
      void patchTemplate({ name, customInstructions: instructions });
    }, AUTOSAVE_MS);
    return () => {
      if (debouncerRef.current) clearTimeout(debouncerRef.current);
    };
  }, [name, instructions, initial.name, initial.customInstructions, patchTemplate]);

  async function changeTrigger(t: TriggerType) {
    setTriggerType(t);
    await patchTemplate({ triggerType: t });
  }

  async function addSubagent() {
    const optimistic: SubAgent = {
      id: `tmp-${Date.now()}`,
      name: 'New subagent',
      role: 'execution',
      instructions: '',
      tools: [],
      order: subagents.length,
    };
    setSubagents((prev) => [...prev, optimistic]);

    const res = await fetch(`/api/agent-templates/${initial.id}/subagents`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: optimistic.name, role: optimistic.role }),
    });
    if (!res.ok) {
      setSubagents((prev) => prev.filter((s) => s.id !== optimistic.id));
      return;
    }
    const row = (await res.json()) as SubAgent;
    setSubagents((prev) => prev.map((s) => (s.id === optimistic.id ? row : s)));
    setEditingSubId(row.id);
  }

  async function patchSubagent(subId: string, patch: Partial<SubAgent>) {
    setSubagents((prev) =>
      prev.map((s) => (s.id === subId ? { ...s, ...patch } : s)),
    );
    await fetch(`/api/agent-templates/${initial.id}/subagents/${subId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    });
  }

  async function deleteSubagent(subId: string) {
    setSubagents((prev) => prev.filter((s) => s.id !== subId));
    if (editingSubId === subId) setEditingSubId(null);
    await fetch(`/api/agent-templates/${initial.id}/subagents/${subId}`, {
      method: 'DELETE',
    });
  }

  async function move(subId: string, direction: -1 | 1) {
    const idx = subagents.findIndex((s) => s.id === subId);
    if (idx < 0) return;
    const next = idx + direction;
    if (next < 0 || next >= subagents.length) return;
    const reordered = [...subagents];
    const [moved] = reordered.splice(idx, 1);
    reordered.splice(next, 0, moved);
    const renumbered = reordered.map((s, i) => ({ ...s, order: i }));
    setSubagents(renumbered);
    // Persist the two affected rows.
    await Promise.all(
      renumbered.map((s) =>
        fetch(`/api/agent-templates/${initial.id}/subagents/${s.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ order: s.order }),
        }),
      ),
    );
  }

  async function deleteTemplate() {
    if (!confirm('Delete this template? Subagents go with it.')) return;
    await fetch(`/api/agent-templates/${initial.id}`, { method: 'DELETE' });
    router.push(`/s/${spaceSlug}/agents/templates`);
  }

  return (
    <div className="mx-auto max-w-[1500px] px-6 py-8">
      <header className="mb-8 flex items-end justify-between gap-4">
        <div>
          <Link
            href={`/s/${spaceSlug}/agents/templates`}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            ← All templates
          </Link>
          <p className={cn(SERIF_DISPLAY, 'mt-2')}>{name || 'Untitled'}</p>
        </div>
        <div className="flex items-center gap-3">
          <SaveIndicator status={saveStatus} />
          <button
            type="button"
            onClick={deleteTemplate}
            className="rounded-md p-2 text-muted-foreground hover:bg-rose-500/10 hover:text-rose-700"
            aria-label="Delete template"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </header>

      <div className="grid gap-10 lg:grid-cols-[2fr_3fr]">
        {/* ── Left pane: name + instructions ──────────────────────────── */}
        <section className="space-y-6">
          <div className="space-y-2">
            <label className={cn(BODY, 'block font-medium')} htmlFor="name">
              Name
            </label>
            <input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground focus:border-foreground focus:outline-none"
            />
          </div>

          <div className="space-y-2">
            <label
              className={cn(BODY, 'block font-medium')}
              htmlFor="instructions"
            >
              Custom instructions
            </label>
            <p className={BODY_MUTED}>
              What this agent is for, in your own words.
            </p>
            <textarea
              id="instructions"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              maxLength={10000}
              rows={10}
              placeholder="Find the right contact at each lead, then write a short opener that names what they ship."
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-foreground focus:outline-none"
            />
          </div>
        </section>

        {/* ── Right pane: workflow graph ──────────────────────────────── */}
        <section className="space-y-6">
          <p className={CAPTION}>Workflow</p>

          <div className="space-y-0">
            {/* Trigger pill */}
            <div className="flex justify-center">
              <TriggerPill
                triggerType={triggerType}
                onChange={changeTrigger}
              />
            </div>

            <Connector />

            {/* Main agent node */}
            <div className="flex justify-center">
              <MainAgentNode name={name || 'Untitled'} />
            </div>

            <Connector />

            {/* Subagents row */}
            {subagents.length === 0 ? (
              <div className="flex justify-center">
                <AddSubagentButton onClick={addSubagent} />
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex flex-wrap items-start justify-center gap-3">
                  {subagents.map((s, i) => (
                    <SubAgentNode
                      key={s.id}
                      subagent={s}
                      active={editingSubId === s.id}
                      canMoveLeft={i > 0}
                      canMoveRight={i < subagents.length - 1}
                      onOpen={() =>
                        setEditingSubId(editingSubId === s.id ? null : s.id)
                      }
                      onMoveLeft={() => move(s.id, -1)}
                      onMoveRight={() => move(s.id, 1)}
                    />
                  ))}
                  <AddSubagentButton onClick={addSubagent} compact />
                </div>

                {editingSubId &&
                  subagents.find((s) => s.id === editingSubId) && (
                    <SubAgentEditor
                      subagent={subagents.find((s) => s.id === editingSubId)!}
                      allToolNames={allToolNames}
                      onChange={(patch) => patchSubagent(editingSubId, patch)}
                      onClose={() => setEditingSubId(null)}
                      onDelete={() => deleteSubagent(editingSubId)}
                    />
                  )}
              </div>
            )}
          </div>

          <IntegrationIconRow toolkits={connectedToolkits} spaceSlug={spaceSlug} />
        </section>
      </div>
    </div>
  );
}

// ── Save indicator ─────────────────────────────────────────────────────────

function SaveIndicator({
  status,
}: {
  status: 'idle' | 'saving' | 'saved' | 'error';
}) {
  if (status === 'idle') return null;
  const text =
    status === 'saving'
      ? 'Saving…'
      : status === 'saved'
        ? 'Saved'
        : 'Save failed';
  const tone =
    status === 'error'
      ? 'text-rose-700'
      : status === 'saved'
        ? 'text-emerald-700'
        : 'text-muted-foreground';
  return <span className={cn('text-xs', tone)}>{text}</span>;
}

// ── Trigger pill ───────────────────────────────────────────────────────────

function TriggerPill({
  triggerType,
  onChange,
}: {
  triggerType: TriggerType;
  onChange: (t: TriggerType) => void;
}) {
  return (
    <div className="relative">
      <select
        value={triggerType}
        onChange={(e) => onChange(e.target.value as TriggerType)}
        aria-label="Trigger"
        className="appearance-none rounded-full border border-border bg-background py-1.5 pl-8 pr-7 text-xs font-medium text-foreground hover:border-foreground/40 focus:outline-none"
      >
        {TRIGGER_TYPES.map((t) => (
          <option key={t.type} value={t.type}>
            {t.label}
          </option>
        ))}
      </select>
      <Zap className="pointer-events-none absolute left-3 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
    </div>
  );
}

// ── Connector (vertical dashed segment between rows) ───────────────────────

function Connector() {
  return (
    <div className="flex justify-center" aria-hidden>
      <svg width="2" height="32" className="text-border">
        <line
          x1="1"
          y1="0"
          x2="1"
          y2="32"
          stroke="currentColor"
          strokeWidth="1"
          strokeDasharray="4 4"
        />
      </svg>
    </div>
  );
}

// ── Main agent node ────────────────────────────────────────────────────────

function MainAgentNode({ name }: { name: string }) {
  return (
    <div className="min-w-[200px] max-w-[260px] rounded-xl border-2 border-foreground bg-background px-5 py-4 text-center shadow-[0_1px_0_rgba(0,0,0,0.04)]">
      <p className={cn(MONO_CHIP, 'mb-1 text-muted-foreground')}>Task agent</p>
      <p className={cn(SERIF_CARD, 'truncate text-foreground')}>{name}</p>
    </div>
  );
}

// ── Subagent node ──────────────────────────────────────────────────────────

function SubAgentNode({
  subagent,
  active,
  canMoveLeft,
  canMoveRight,
  onOpen,
  onMoveLeft,
  onMoveRight,
}: {
  subagent: SubAgent;
  active: boolean;
  canMoveLeft: boolean;
  canMoveRight: boolean;
  onOpen: () => void;
  onMoveLeft: () => void;
  onMoveRight: () => void;
}) {
  return (
    <div
      className={cn(
        'flex w-[180px] flex-col gap-1 rounded-xl border bg-background px-4 py-3 transition-colors',
        active
          ? 'border-foreground bg-foreground/[0.03]'
          : 'border-border/70 hover:border-foreground/40',
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        className="flex flex-col items-start gap-1 text-left"
      >
        <span className={cn(MONO_CHIP, 'text-muted-foreground')}>
          {subagent.role}
        </span>
        <span className={cn(SERIF_CARD, 'truncate text-foreground')}>
          {subagent.name}
        </span>
      </button>
      <div className="flex items-center justify-between">
        <span className={cn(CAPTION)}>
          {subagent.tools.length} tool{subagent.tools.length === 1 ? '' : 's'}
        </span>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            disabled={!canMoveLeft}
            onClick={onMoveLeft}
            className="rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
            aria-label="Move left"
          >
            <ChevronUp className="h-3 w-3 -rotate-90" />
          </button>
          <button
            type="button"
            disabled={!canMoveRight}
            onClick={onMoveRight}
            className="rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
            aria-label="Move right"
          >
            <ChevronUp className="h-3 w-3 rotate-90" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Add-subagent button ────────────────────────────────────────────────────

function AddSubagentButton({
  onClick,
  compact = false,
}: {
  onClick: () => void;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-border/70 bg-background text-sm text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground',
        compact ? 'h-[88px] w-[180px]' : 'h-12 px-5',
      )}
    >
      <Plus className="h-4 w-4" />
      Add subagent
    </button>
  );
}

// ── Inline subagent editor ─────────────────────────────────────────────────

function SubAgentEditor({
  subagent,
  allToolNames,
  onChange,
  onClose,
  onDelete,
}: {
  subagent: SubAgent;
  allToolNames: string[];
  onChange: (patch: Partial<SubAgent>) => void;
  onClose: () => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(subagent.name);
  const [instructions, setInstructions] = useState(subagent.instructions);

  // Sync if the parent's subagent prop changes (after a patch settles).
  useEffect(() => {
    setName(subagent.name);
    setInstructions(subagent.instructions);
  }, [subagent.id, subagent.name, subagent.instructions]);

  function toggleTool(tool: string) {
    const next = subagent.tools.includes(tool)
      ? subagent.tools.filter((t) => t !== tool)
      : [...subagent.tools, tool];
    onChange({ tools: next });
  }

  return (
    <div className="rounded-xl border border-border/70 bg-card p-6">
      <div className="mb-4 flex items-start justify-between gap-4">
        <p className={cn(SERIF_CARD)}>Edit subagent</p>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md p-1 text-muted-foreground hover:text-foreground"
          aria-label="Close editor"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-[1fr_1fr]">
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className={cn(BODY, 'font-medium')} htmlFor="sub-name">
              Name
            </label>
            <input
              id="sub-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => {
                const trimmed = name.trim();
                if (trimmed.length > 0 && trimmed !== subagent.name) {
                  onChange({ name: trimmed });
                }
              }}
              maxLength={100}
              className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm focus:border-foreground focus:outline-none"
            />
          </div>

          <div className="space-y-1.5">
            <label className={cn(BODY, 'font-medium')} htmlFor="sub-role">
              Role
            </label>
            <select
              id="sub-role"
              value={subagent.role}
              onChange={(e) =>
                onChange({ role: e.target.value as SubAgentRole })
              }
              className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm focus:border-foreground focus:outline-none"
            >
              {SUBAGENT_ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label
              className={cn(BODY, 'font-medium')}
              htmlFor="sub-instructions"
            >
              Instructions
            </label>
            <textarea
              id="sub-instructions"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              onBlur={() => {
                if (instructions !== subagent.instructions) {
                  onChange({ instructions });
                }
              }}
              rows={6}
              maxLength={10000}
              placeholder="What this subagent does, in one or two sentences."
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:border-foreground focus:outline-none"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <p className={cn(BODY, 'font-medium')}>Tools</p>
          <p className={BODY_MUTED}>
            What this subagent can call.
          </p>
          <div className="max-h-[280px] space-y-1 overflow-y-auto rounded-md border border-border/60 p-2">
            {allToolNames.map((tool) => {
              const checked = subagent.tools.includes(tool);
              return (
                <label
                  key={tool}
                  className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-muted/40"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleTool(tool)}
                    className="h-3.5 w-3.5"
                  />
                  <span className="font-mono text-xs">{tool}</span>
                </label>
              );
            })}
          </div>
        </div>
      </div>

      <div className="mt-6 flex items-center justify-between">
        <button
          type="button"
          onClick={onDelete}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-rose-700"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Remove subagent
        </button>
      </div>
    </div>
  );
}

// ── Integration icon row ───────────────────────────────────────────────────

function IntegrationIconRow({
  toolkits,
  spaceSlug,
}: {
  toolkits: Toolkit[];
  spaceSlug: string;
}) {
  if (toolkits.length === 0) {
    return (
      <Link
        href={`/s/${spaceSlug}/integrations`}
        className={cn(
          BODY_MUTED,
          'flex items-center justify-center rounded-lg border border-dashed border-border/70 py-4 hover:border-foreground/40 hover:text-foreground',
        )}
      >
        Connect integrations to give this agent tools.
      </Link>
    );
  }

  const shown = toolkits.slice(0, MAX_TOOLKIT_ICONS);
  const overflow = toolkits.length - shown.length;

  return (
    <Link
      href={`/s/${spaceSlug}/integrations`}
      className="flex items-center justify-center gap-2 rounded-lg border border-border/60 bg-card py-3 transition-colors hover:bg-muted/40"
      aria-label="Manage integrations"
    >
      {shown.map((t) => (
        <span
          key={t.toolkit}
          title={t.name}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-background text-[10px] font-medium uppercase text-muted-foreground"
        >
          {t.name.slice(0, 2)}
        </span>
      ))}
      {overflow > 0 && (
        <span className="inline-flex h-7 items-center justify-center rounded-md border border-border bg-background px-2 text-[11px] text-muted-foreground">
          +{overflow}
        </span>
      )}
    </Link>
  );
}
