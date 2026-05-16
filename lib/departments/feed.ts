/**
 * Department page feed loader — Charles activity for one department,
 * categorized for the filter pills, plus the integration-connection status
 * strip.
 *
 * Activity comes from `loadAuditFeed`, which already aggregates
 * SwarmMember + AgentDraft + AgentPausedRun + IntegrationConnection +
 * WorkspaceStage + StageGate and tags each row with a department when
 * applicable. We filter to this department, classify each entry into a
 * filter category, and return the connection strip alongside.
 *
 * Pure-ish — reads Supabase, returns a value. Safe to call from a server
 * component during render.
 */

import { loadAuditFeed, type AuditEvent } from '@/lib/observability/audit-feed';
import { supabase } from '@/lib/supabase';
import { logger } from '@/lib/logger';
import type { DepartmentSlug } from '@/lib/departments/autonomy';
import {
  getDepartmentPageConfig,
  type DepartmentPageConfig,
  type ToolkitConnection,
} from '@/lib/departments/page-config';

export interface DepartmentFeedEntry {
  /** Stable id from the underlying audit event. */
  id: string;
  /** Filter category slug — one of config.filters[].slug or 'general'. */
  category: string;
  /** Founder-readable, one sentence. */
  summary: string;
  /** Underlying event kind for the icon / colour pick. */
  kind: AuditEvent['type'];
  occurredAt: string;
  actor: AuditEvent['actor'];
}

export type ConnectionState =
  | 'active'
  | 'expired'
  | 'revoked'
  | 'failed'
  | 'not_connected'
  | 'coming_soon';

export interface DepartmentConnection {
  toolkit: string;
  label: string;
  state: ConnectionState;
  /** Provider deep-link. Always present from the config. */
  externalUrl: string;
  /** Filter pill the toolkit's actions land under. */
  category: string;
  lastUsedAt: string | null;
}

export interface DepartmentFeed {
  config: DepartmentPageConfig;
  entries: DepartmentFeedEntry[];
  connections: DepartmentConnection[];
}

const FEED_FETCH_LIMIT = 80;

interface ConnectionRow {
  toolkit: string;
  status: 'active' | 'expired' | 'revoked' | 'failed';
  label: string | null;
  lastUsedAt: string | null;
}

async function loadConnections(
  spaceId: string,
  toolkits: readonly ToolkitConnection[],
): Promise<DepartmentConnection[]> {
  if (toolkits.length === 0) return [];

  const toolkitSet = toolkits.map((t) => t.toolkit);
  const { data, error } = await supabase
    .from('IntegrationConnection')
    .select('toolkit, status, label, lastUsedAt')
    .eq('spaceId', spaceId)
    .in('toolkit', toolkitSet);

  if (error) {
    logger.warn('[dept-feed] integration connection lookup failed', {
      spaceId,
      err: error.message,
    });
  }

  const rows = ((data ?? []) as ConnectionRow[]);
  // Most-recently-active wins per toolkit (in case of duplicates or
  // historical inactive rows; the unique-index only constrains active).
  const byToolkit = new Map<string, ConnectionRow>();
  for (const r of rows) {
    const prev = byToolkit.get(r.toolkit);
    if (!prev) {
      byToolkit.set(r.toolkit, r);
      continue;
    }
    if (r.status === 'active' && prev.status !== 'active') {
      byToolkit.set(r.toolkit, r);
    }
  }

  return toolkits.map((t) => {
    // Coming-soon tiles never resolve to a live IntegrationConnection
    // row; they render their own gray state.
    if (t.comingSoon) {
      return {
        toolkit: t.toolkit,
        label: t.label,
        state: 'coming_soon' as ConnectionState,
        externalUrl: t.externalUrl,
        category: t.category,
        lastUsedAt: null,
      };
    }
    const row = byToolkit.get(t.toolkit);
    return {
      toolkit: t.toolkit,
      label: t.label,
      state: (row ? row.status : 'not_connected') as ConnectionState,
      externalUrl: t.externalUrl,
      category: t.category,
      lastUsedAt: row?.lastUsedAt ?? null,
    };
  });
}

export async function loadDepartmentFeed(
  spaceId: string,
  deptSlug: DepartmentSlug,
): Promise<DepartmentFeed | null> {
  const config = getDepartmentPageConfig(deptSlug);
  if (!config) return null;

  const [auditResult, connections] = await Promise.all([
    (async () => {
      try {
        return await loadAuditFeed(spaceId, { limit: FEED_FETCH_LIMIT });
      } catch (err) {
        logger.warn('[dept-feed] audit feed load failed', { err: String(err) });
        return [] as AuditEvent[];
      }
    })(),
    loadConnections(spaceId, config.toolkits),
  ]);

  // Filter to this department's events. Audit events without a department
  // are workspace-scope (stage advances, integration connects) — for the
  // dept page we want only the ones tagged with this dept.
  const deptEvents = auditResult.filter((e) => e.department === deptSlug);

  const entries: DepartmentFeedEntry[] = deptEvents.map((e) => ({
    id: e.id,
    category: config.classify(e.summary, e.department),
    summary: e.summary,
    kind: e.type,
    occurredAt: e.occurredAt,
    actor: e.actor,
  }));

  return { config, entries, connections };
}
