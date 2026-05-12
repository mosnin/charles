/**
 * SDK skill factories — verify each builder produces a usable Agent and
 * that `.asTool()` yields a FunctionTool the SDK can invoke.
 *
 * We do NOT call `run(agent, ...)` here — that would hit OpenAI. The
 * construction + `asTool` conversion is what this module owns; the SDK
 * itself is responsible for the actual run loop and is covered by its
 * own tests upstream.
 */

import { describe, it, expect } from 'vitest';
import { Agent } from '@openai/agents';
import { buildPipelineAnalystAgent, buildContactResearcherAgent } from '@/lib/ai-tools/sdk-skills';
import type { ToolContext } from '@/lib/ai-tools/types';

function makeCtx(): ToolContext {
  return {
    userId: 'u_1',
    space: { id: 's_1', slug: 'jane', name: 'Jane Realty', ownerId: 'u_1' },
    signal: new AbortController().signal,
  };
}

describe('buildPipelineAnalystAgent', () => {
  it('returns an Agent with name pipeline_analyst and a non-empty tools array', () => {
    const agent = buildPipelineAnalystAgent(makeCtx());
    expect(agent).toBeInstanceOf(Agent);
    expect(agent.name).toBe('pipeline_analyst');
    expect(Array.isArray(agent.tools)).toBe(true);
    expect(agent.tools.length).toBeGreaterThan(0);
  });

  it('includes the contact and history tools the skill needs', () => {
    const agent = buildPipelineAnalystAgent(makeCtx());
    const names = agent.tools.map((t) => t.name);
    // If someone trims the allowlist later, this fails loudly.
    expect(names).toContain('find_person');
    expect(names).toContain('recall_history');
    expect(names).toContain('create_plan');
  });

  it('asTool() produces a FunctionTool with the founder-tuned name + description', () => {
    const agent = buildPipelineAnalystAgent(makeCtx());
    const asTool = agent.asTool({
      toolName: 'analyze_pipeline',
      toolDescription:
        'Analyze the contact pipeline and surface who needs follow-up.',
    });
    expect(asTool.type).toBe('function');
    expect(asTool.name).toBe('analyze_pipeline');
    expect(asTool.description).toMatch(/contact pipeline/);
    // The SDK's FunctionTool exposes an `invoke` method — that's the
    // contract the runtime calls when the model picks this tool.
    expect(typeof asTool.invoke).toBe('function');
  });
});

describe('buildContactResearcherAgent', () => {
  it('returns an Agent with name contact_researcher and a non-empty tools array', () => {
    const agent = buildContactResearcherAgent(makeCtx());
    expect(agent).toBeInstanceOf(Agent);
    expect(agent.name).toBe('contact_researcher');
    expect(Array.isArray(agent.tools)).toBe(true);
    expect(agent.tools.length).toBeGreaterThan(0);
  });

  it('includes find_person and recall_history — the core lookup tools', () => {
    const agent = buildContactResearcherAgent(makeCtx());
    const names = agent.tools.map((t) => t.name);
    expect(names).toContain('find_person');
    expect(names).toContain('recall_history');
  });

  it('asTool() produces a FunctionTool with the founder-tuned name + description', () => {
    const agent = buildContactResearcherAgent(makeCtx());
    const asTool = agent.asTool({
      toolName: 'research_person',
      toolDescription:
        'Research everything we know about a person and recommend the next action.',
    });
    expect(asTool.type).toBe('function');
    expect(asTool.name).toBe('research_person');
    expect(asTool.description).toMatch(/Research/);
    expect(typeof asTool.invoke).toBe('function');
  });
});
