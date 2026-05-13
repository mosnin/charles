/**
 * Department autonomy — read / write the per-department "how loud is Charles
 * allowed to be" knob.
 *
 * Surface for two callers:
 *   1. The /api/departments/[slug]/autonomy PATCH route (founder UI).
 *   2. The agent runtime, which calls `getDepartmentAutonomy` before any
 *      mutating tool runs to decide: pass through (autonomous), gate
 *      (ask), gate-with-policy (auto-low), or refuse (observe).
 *
 * Defaults: when no Department row exists for a given (spaceId, slug) we
 * return `ask`. Some founders skipped onboarding seeding entirely; the
 * runtime must not crash because of that. Missing row === safe default.
 */
import { supabase } from '@/lib/supabase';

export type AutonomyLevel = 'observe' | 'ask' | 'auto-low' | 'autonomous';
export type DepartmentSlug =
  | 'engineering'
  | 'sales'
  | 'marketing'
  | 'design'
  | 'support'
  | 'ops_finance';

export const DEFAULT_AUTONOMY: AutonomyLevel = 'ask';

export const AUTONOMY_LEVELS: readonly AutonomyLevel[] = [
  'observe',
  'ask',
  'auto-low',
  'autonomous',
] as const;

export const ALL_DEPARTMENTS: readonly DepartmentSlug[] = [
  'engineering',
  'design',
  'marketing',
  'sales',
  'support',
  'ops_finance',
] as const;

export function isAutonomyLevel(v: unknown): v is AutonomyLevel {
  return typeof v === 'string' && (AUTONOMY_LEVELS as readonly string[]).includes(v);
}

export function isDepartmentSlug(v: unknown): v is DepartmentSlug {
  return typeof v === 'string' && (ALL_DEPARTMENTS as readonly string[]).includes(v);
}

/** Human-readable name for each department slug. Kept here so the API,
 *  the UI, and the seed insert all agree. */
export const DEPARTMENT_NAMES: Record<DepartmentSlug, string> = {
  engineering: 'Engineering',
  design: 'Design',
  marketing: 'Marketing',
  sales: 'Sales',
  support: 'Support',
  ops_finance: 'Ops / Finance',
};

/**
 * Returns the autonomy level for one department. Missing row → DEFAULT_AUTONOMY.
 *
 * Never throws on missing department — this is the function the agent
 * runtime calls before each mutating tool, and a DB hiccup or unseeded
 * row must never break a run.
 */
export async function getDepartmentAutonomy(
  spaceId: string,
  slug: DepartmentSlug,
): Promise<AutonomyLevel> {
  const { data } = await supabase
    .from('Department')
    .select('autonomyLevel')
    .eq('spaceId', spaceId)
    .eq('slug', slug)
    .maybeSingle();

  const level = (data as { autonomyLevel?: string } | null)?.autonomyLevel;
  return isAutonomyLevel(level) ? level : DEFAULT_AUTONOMY;
}

/**
 * Returns autonomy for all six departments. Missing rows are filled with
 * DEFAULT_AUTONOMY so callers always get a complete record.
 */
export async function getAllDepartmentAutonomy(
  spaceId: string,
): Promise<Record<DepartmentSlug, AutonomyLevel>> {
  const result = Object.fromEntries(
    ALL_DEPARTMENTS.map((s) => [s, DEFAULT_AUTONOMY]),
  ) as Record<DepartmentSlug, AutonomyLevel>;

  const { data } = await supabase
    .from('Department')
    .select('slug, autonomyLevel')
    .eq('spaceId', spaceId);

  const rows = (data ?? []) as Array<{ slug?: string; autonomyLevel?: string }>;
  for (const row of rows) {
    if (isDepartmentSlug(row.slug) && isAutonomyLevel(row.autonomyLevel)) {
      result[row.slug] = row.autonomyLevel;
    }
  }
  return result;
}

/**
 * Persists an autonomy change. Defensive UPSERT — if the Department row
 * doesn't exist (founder skipped onboarding seed), we insert it with the
 * given level. Otherwise we update the existing row.
 *
 * Throws on DB error so the API route can surface a 500.
 */
export async function setDepartmentAutonomy(
  spaceId: string,
  slug: DepartmentSlug,
  level: AutonomyLevel,
): Promise<void> {
  const { error } = await supabase
    .from('Department')
    .upsert(
      {
        spaceId,
        slug,
        name: DEPARTMENT_NAMES[slug],
        autonomyLevel: level,
      },
      { onConflict: 'spaceId,slug' },
    );

  if (error) {
    throw new Error(`Failed to persist autonomy: ${error.message}`);
  }
}
