/**
 * DepartmentPage — the unified per-department surface.
 *
 * Server component. Renders:
 *   - Header (dept name + blurb), reused from the existing page chrome
 *   - Connection strip — one tile per integration toolkit this dept owns
 *   - Live "in flight" strip (client island, subscribed to canvasActivity)
 *   - Filter pills + activity feed (client island, owns selection state)
 *
 * Engineering is the first department wired to this template. The other
 * five land in phase 5 by adding their entries to DEPARTMENT_PAGE_CONFIGS.
 */

import Link from 'next/link';
import { ArrowUpRight, Check, AlertTriangle, Plug } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  H1,
  TITLE_FONT,
  BODY_MUTED,
  PAGE_RHYTHM,
  PAGE_MAX,
  CAPTION,
  SECTION_LABEL,
} from '@/lib/typography';
import type { DepartmentConfig } from '@/lib/departments/workflows';
import type {
  DepartmentFeed,
  DepartmentConnection,
  ConnectionState,
} from '@/lib/departments/feed';
import { DepartmentPageFilters } from './department-page-filters';
import { DepartmentLiveStrip } from './department-live-strip';

interface Props {
  workflowConfig: DepartmentConfig;
  feed: DepartmentFeed;
  spaceId: string;
  spaceSlug: string;
}

function connectionDescriptor(state: ConnectionState): {
  label: string;
  className: string;
  Icon: typeof Check;
} {
  switch (state) {
    case 'active':
      return {
        label: 'Connected',
        className: 'text-emerald-700 bg-emerald-50 dark:text-emerald-400 dark:bg-emerald-500/15',
        Icon: Check,
      };
    case 'expired':
      return {
        label: 'Expired',
        className: 'text-amber-700 bg-amber-50 dark:text-amber-400 dark:bg-amber-500/15',
        Icon: AlertTriangle,
      };
    case 'failed':
      return {
        label: 'Error',
        className: 'text-red-700 bg-red-50 dark:text-red-400 dark:bg-red-500/15',
        Icon: AlertTriangle,
      };
    case 'revoked':
      return {
        label: 'Revoked',
        className: 'text-muted-foreground bg-muted',
        Icon: Plug,
      };
    default:
      return {
        label: 'Not connected',
        className: 'text-muted-foreground bg-muted',
        Icon: Plug,
      };
  }
}

function ConnectionTile({
  connection,
  spaceSlug,
}: {
  connection: DepartmentConnection;
  spaceSlug: string;
}) {
  const { label, className, Icon } = connectionDescriptor(connection.state);
  const isConnected = connection.state === 'active';
  const href = isConnected ? connection.externalUrl : `/s/${spaceSlug}/integrations`;
  const externalProps = isConnected
    ? { target: '_blank' as const, rel: 'noopener noreferrer' as const }
    : {};

  return (
    <Link
      href={href}
      {...externalProps}
      className={cn(
        'group flex items-center justify-between gap-3 rounded-xl border border-border',
        'bg-background px-4 py-3 transition-colors hover:bg-foreground/[0.02]',
      )}
    >
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">{connection.label}</p>
        <p className={cn(CAPTION, 'mt-0.5 inline-flex items-center gap-1')}>
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium',
              className,
            )}
          >
            <Icon size={9} strokeWidth={2.5} />
            {label}
          </span>
        </p>
      </div>
      <ArrowUpRight
        size={14}
        className="shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
      />
    </Link>
  );
}

export function DepartmentPage({ workflowConfig, feed, spaceId, spaceSlug }: Props) {
  const integrationsHref = `/s/${spaceSlug}/integrations`;

  return (
    <div className={`${PAGE_RHYTHM} ${PAGE_MAX} mx-auto px-6 py-8`}>
      <header className="space-y-2">
        <h1 className={H1} style={TITLE_FONT}>
          {workflowConfig.name}
        </h1>
        <p className={BODY_MUTED}>{workflowConfig.blurb}</p>
      </header>

      {/* Connections strip */}
      <section className="space-y-2">
        <p className={SECTION_LABEL}>Integrations</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {feed.connections.map((c) => (
            <ConnectionTile key={c.toolkit} connection={c} spaceSlug={spaceSlug} />
          ))}
        </div>
      </section>

      {/* Live "in flight" strip — silent when nothing is running. */}
      <DepartmentLiveStrip spaceId={spaceId} deptSlug={workflowConfig.slug} />

      {/* Filter pills + activity feed */}
      <section className="space-y-3">
        <p className={SECTION_LABEL}>Activity</p>
        <DepartmentPageFilters
          entries={feed.entries}
          filters={feed.config.filters}
          integrationsHref={integrationsHref}
        />
      </section>
    </div>
  );
}
