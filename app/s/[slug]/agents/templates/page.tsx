/**
 * /s/[slug]/agents/templates — the founder's roster of custom agent templates.
 *
 * One screen, one job: pick a template to open in the builder, or start a
 * new one. Empty state is the prompt. No filters. No tabs. No tags. If
 * there are five templates, you see five names. The decision is "which".
 */

import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import { ArrowUpRight, Plus } from 'lucide-react';
import { getSpaceFromSlug } from '@/lib/space';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import {
  H1,
  TITLE_FONT,
  BODY_MUTED,
  PAGE_RHYTHM,
  READING_MAX,
  PRIMARY_PILL,
  META,
  SERIF_CARD,
} from '@/lib/typography';
import { TRIGGER_TYPES, type TriggerType } from '@/lib/agent-templates/catalog';

interface AgentRow {
  id: string;
  name: string;
  triggerType: TriggerType | null;
  createdAt: string;
  updatedAt: string;
}

function triggerLabel(t: TriggerType | null): string {
  const found = TRIGGER_TYPES.find((x) => x.type === (t ?? 'manual'));
  return found?.label ?? 'Manual';
}

export default async function TemplatesPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { userId } = await auth();
  if (!userId) redirect('/login/realtor');

  const space = await getSpaceFromSlug(slug);
  if (!space) notFound();

  const { data } = await supabase
    .from('CustomAgent')
    .select('id, name, triggerType, createdAt, updatedAt')
    .eq('spaceId', space.id)
    .eq('kind', 'custom')
    .order('createdAt', { ascending: false });

  const rows = (data ?? []) as AgentRow[];

  // Subagent counts in one batched query.
  let counts: Record<string, number> = {};
  if (rows.length > 0) {
    const ids = rows.map((r) => r.id);
    const { data: subs } = await supabase
      .from('AgentSubAgent')
      .select('customAgentId')
      .in('customAgentId', ids);
    counts = ((subs ?? []) as { customAgentId: string }[]).reduce(
      (acc, r) => {
        acc[r.customAgentId] = (acc[r.customAgentId] ?? 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );
  }

  return (
    <div className={cn(PAGE_RHYTHM, READING_MAX, 'mx-auto px-6 py-12')}>
      <header className="flex items-end justify-between gap-6">
        <div className="space-y-2">
          <h1 className={H1} style={TITLE_FONT}>
            Agent templates
          </h1>
          <p className={BODY_MUTED}>
            A template is a task agent and the subagents it dispatches.
          </p>
        </div>
        <Link
          href={`/s/${space.slug}/agents/templates/new`}
          className={PRIMARY_PILL}
        >
          <Plus className="h-4 w-4" />
          New template
        </Link>
      </header>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-border/60 bg-card px-6 py-16 text-center">
          <p className={cn(SERIF_CARD, 'mb-2 text-foreground')}>
            No templates yet.
          </p>
          <p className={BODY_MUTED}>
            Start with a name and a trigger. Add subagents inside.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-border/60 rounded-lg border border-border/60 bg-card">
          {rows.map((row) => (
            <li key={row.id}>
              <Link
                href={`/s/${space.slug}/agents/templates/${row.id}`}
                className="group flex items-center justify-between gap-6 px-6 py-5 transition-colors hover:bg-muted/40"
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <p className={cn(SERIF_CARD, 'truncate text-foreground')}>
                    {row.name}
                  </p>
                  <p className={cn(META)}>
                    {triggerLabel(row.triggerType)} · {counts[row.id] ?? 0}{' '}
                    {counts[row.id] === 1 ? 'subagent' : 'subagents'}
                  </p>
                </div>
                <ArrowUpRight className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
