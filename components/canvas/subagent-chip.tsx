/**
 * Subagent activity chip — a one-line readout of what a department is doing
 * right now. Lives inside the chat dock's message thread, today as static
 * examples, tomorrow wired to SwarmMember rows.
 */

import Image from 'next/image';
import { cn } from '@/lib/utils';
import { MONO_META } from '@/lib/typography';
import type { DepartmentSlug } from '@/lib/departments/autonomy';
import { iconForDepartment } from '@/lib/icons/manifest';
import { MonoChip, type ChipTone } from './mono-chip';

export type SubagentStatus = 'running' | 'queued' | 'done';

const STATUS_TO_TONE: Record<SubagentStatus, ChipTone> = {
  running: 'running',
  queued: 'queued',
  done: 'done',
};

const STATUS_LABEL: Record<SubagentStatus, string> = {
  running: 'Running',
  queued: 'Queued',
  done: 'Done',
};

interface Props {
  department: DepartmentSlug;
  /** Display name for the agent — e.g. "Growth Agent". */
  agentName: string;
  /** What it's doing — e.g. "Building prospect list". */
  task: string;
  status: SubagentStatus;
  /** e.g. "00:42" or "3m". */
  duration?: string;
  className?: string;
}

function DeptGlyph({ slug }: { slug: DepartmentSlug }) {
  return (
    <Image
      src={iconForDepartment(slug)}
      alt=""
      width={20}
      height={20}
      className="h-5 w-5 flex-shrink-0"
      aria-hidden
    />
  );
}

export function SubagentChip({
  department,
  agentName,
  task,
  status,
  duration,
  className,
}: Props) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2 py-1.5',
        className,
      )}
      data-testid="subagent-chip"
    >
      <DeptGlyph slug={department} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12px] font-medium text-slate-900">{agentName}</div>
        <div className="truncate text-[11px] text-slate-500">{task}</div>
      </div>
      <MonoChip tone={STATUS_TO_TONE[status]}>{STATUS_LABEL[status]}</MonoChip>
      {duration && <span className={cn(MONO_META, 'flex-shrink-0')}>{duration}</span>}
    </div>
  );
}
