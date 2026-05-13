/**
 * /s/[slug]/agents/templates/[id] — the builder.
 *
 * Server-loads the template, its subagents, and the integration row. Hands
 * a client component the initial state. From there the builder owns its
 * own mutations against the API.
 */

import { notFound, redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import { getSpaceFromSlug } from '@/lib/space';
import { supabase } from '@/lib/supabase';
import { TemplateBuilder } from '@/components/canvas/template-builder';
import type { SubAgentRole, TriggerType } from '@/lib/agent-templates/catalog';
import { ALL_TOOLS } from '@/lib/ai-tools/tools';
import { findIntegration } from '@/lib/integrations/catalog';

interface AgentRow {
  id: string;
  spaceId: string;
  name: string;
  triggerType: TriggerType | null;
  customInstructions: string | null;
}

interface SubRow {
  id: string;
  customAgentId: string;
  name: string;
  role: SubAgentRole;
  instructions: string;
  tools: string[];
  order: number;
  createdAt: string;
}

interface ToolkitRow {
  toolkit: string;
}

export default async function BuilderPage({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const { slug, id } = await params;
  const { userId } = await auth();
  if (!userId) redirect('/login/realtor');

  const space = await getSpaceFromSlug(slug);
  if (!space) notFound();

  const { data: agent } = await supabase
    .from('CustomAgent')
    .select('id, spaceId, name, triggerType, customInstructions')
    .eq('id', id)
    .maybeSingle();

  if (!agent || (agent as AgentRow).spaceId !== space.id) notFound();
  const row = agent as AgentRow;

  const { data: subs } = await supabase
    .from('AgentSubAgent')
    .select('id, customAgentId, name, role, instructions, tools, order, createdAt')
    .eq('customAgentId', id)
    .order('order', { ascending: true });

  const { data: toolkitRows } = await supabase
    .from('IntegrationConnection')
    .select('toolkit')
    .eq('spaceId', space.id)
    .eq('status', 'active');

  const connectedToolkits = Array.from(
    new Set(((toolkitRows ?? []) as ToolkitRow[]).map((r) => r.toolkit)),
  )
    .map((slug) => {
      const cat = findIntegration(slug);
      return cat ? { toolkit: slug, name: cat.name } : null;
    })
    .filter((x): x is { toolkit: string; name: string } => x !== null);

  const allToolNames = ALL_TOOLS.map((t) => t.name);

  return (
    <TemplateBuilder
      spaceSlug={space.slug}
      template={{
        id: row.id,
        name: row.name,
        triggerType: (row.triggerType ?? 'manual') as TriggerType,
        customInstructions: row.customInstructions ?? '',
      }}
      subagents={((subs ?? []) as SubRow[]).map((s) => ({
        id: s.id,
        name: s.name,
        role: s.role,
        instructions: s.instructions,
        tools: s.tools,
        order: s.order,
      }))}
      connectedToolkits={connectedToolkits}
      allToolNames={allToolNames}
    />
  );
}
