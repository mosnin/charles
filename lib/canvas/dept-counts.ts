/**
 * Dept counts — how many running / queued SwarmMember rows each department
 * currently has, keyed by department slug.
 *
 * One query, joined to SwarmRun to scope by spaceId. Group in memory. Return
 * a fully populated Record so the UI never has to defend against missing
 * keys: every one of the six departments is present, idle defaults to 1 if
 * nothing is running or queued.
 *
 * No new tables, no new columns. completed / failed rows don't count toward
 * the dot — they're history, not current state.
 */

import { supabase } from '@/lib/supabase';
import { logger } from '@/lib/logger';
import { ALL_DEPARTMENTS, type DepartmentSlug } from '@/lib/departments/autonomy';

export interface DeptCounts {
  running: number;
  queued: number;
  /** Calculated: 0 if running+queued > 0; else 1. */
  idle: number;
}

interface SwarmMemberCountRow {
  role: string | null;
  status: 'queued' | 'running' | 'completed' | 'failed' | null;
}

function emptyCountsBySlug(): Record<DepartmentSlug, DeptCounts> {
  const out = {} as Record<DepartmentSlug, DeptCounts>;
  for (const slug of ALL_DEPARTMENTS) {
    out[slug] = { running: 0, queued: 0, idle: 1 };
  }
  return out;
}

function isDepartmentSlugLoose(v: string | null | undefined): v is DepartmentSlug {
  if (!v) return false;
  return (ALL_DEPARTMENTS as readonly string[]).includes(v);
}

/**
 * Load dept counts for every department in the workspace. Always returns
 * a fully populated record — failure modes (no rows, query error) yield
 * the all-idle default.
 */
export async function loadDeptCounts(
  spaceId: string,
): Promise<Record<DepartmentSlug, DeptCounts>> {
  const counts = emptyCountsBySlug();

  try {
    const { data, error } = await supabase
      .from('SwarmMember')
      .select('role, status, swarmRun:SwarmRun!inner(spaceId)')
      .eq('swarmRun.spaceId', spaceId)
      .in('status', ['queued', 'running']);

    if (error) throw error;

    const rows = (data ?? []) as SwarmMemberCountRow[];
    for (const r of rows) {
      if (!r) continue;
      if (!isDepartmentSlugLoose(r.role)) continue;
      // Belt-and-suspenders: re-filter status client-side so we don't trip
      // on a mock or a future migration that loosens the column type.
      if (r.status === 'running') {
        counts[r.role].running += 1;
      } else if (r.status === 'queued') {
        counts[r.role].queued += 1;
      }
    }
  } catch (err) {
    logger.warn('[dept-counts] query failed', { err: String(err) });
    // Fall through with the all-idle default.
    return emptyCountsBySlug();
  }

  // idle is derived: if anything is running or queued, idle = 0.
  for (const slug of ALL_DEPARTMENTS) {
    const c = counts[slug];
    c.idle = c.running + c.queued > 0 ? 0 : 1;
  }

  return counts;
}
