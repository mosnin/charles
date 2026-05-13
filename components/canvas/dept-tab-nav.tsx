'use client';

/**
 * Department tab nav — a row of pill links across the top of the dept
 * detail page. Active tab gets a subtle filled background + bolder text;
 * inactive tabs are muted with a hover background. Clicking a tab is a
 * Link to the same page with a different `?tab=` — no client state.
 */

import Link from 'next/link';
import { cn } from '@/lib/utils';
import type { DepartmentWorkflowTab } from '@/lib/departments/workflows';

interface Props {
  spaceSlug: string;
  deptSlug: string;
  tabs: readonly DepartmentWorkflowTab[];
  activeSlug: string;
  className?: string;
}

export function DeptTabNav({
  spaceSlug,
  deptSlug,
  tabs,
  activeSlug,
  className,
}: Props) {
  return (
    <nav
      aria-label="Department workflows"
      className={cn('flex flex-wrap items-center gap-1', className)}
      data-testid="dept-tab-nav"
    >
      {tabs.map((tab) => {
        const active = tab.slug === activeSlug;
        return (
          <Link
            key={tab.slug}
            href={`/s/${spaceSlug}/d/${deptSlug}?tab=${tab.slug}`}
            data-testid={`dept-tab-${tab.slug}`}
            data-active={active}
            className={cn(
              'inline-flex items-center rounded-full px-3 py-1.5 text-[13px] transition-colors duration-150',
              active
                ? 'bg-slate-100 font-semibold text-slate-900'
                : 'font-medium text-slate-500 hover:bg-slate-50 hover:text-slate-900',
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
