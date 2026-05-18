/**
 * Public MCP server for Charles — read-only, space-scoped.
 *
 * External clients (Claude Desktop, Cursor, custom agents) connect with a
 * `chs_` bearer or an OAuth JWT, both of which resolve to a single spaceId.
 * Tools never accept a spaceId argument — scope is bound at server build
 * time so a leaked-but-correctly-scoped key can't cross workspaces.
 *
 * Phase 6 contract: READ-ONLY. No mutating tools. If a future phase
 * exposes writes, they must flow through the approval gates.
 */
import { NextRequest } from 'next/server';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import { supabase } from '@/lib/supabase';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import crypto from 'crypto';
import { jwtVerify } from 'jose';
import { loadAuditFeed } from '@/lib/observability/audit-feed';
import { loadRollup } from '@/lib/observability/cost-events';
import { STAGES, type Stage } from '@/lib/stages/catalog';
import {
  getAllDepartmentAutonomy,
  DEPARTMENT_NAMES,
  ALL_DEPARTMENTS,
} from '@/lib/departments/autonomy';

function baseUrl(): string {
  const url = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL;
  if (url) return url.replace(/\/$/, '');
  if (process.env.NEXT_PUBLIC_ROOT_DOMAIN) {
    return `https://${process.env.NEXT_PUBLIC_ROOT_DOMAIN}`;
  }
  return 'https://app.charles.dev';
}

// ---------------------------------------------------------------------------
// Auth – validate Bearer token (supports both raw API keys and OAuth JWTs)
// ---------------------------------------------------------------------------
async function authenticateKey(req: NextRequest): Promise<{ spaceId: string; ip: string } | null> {
  const auth = req.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) return null;
  const token = auth.slice(7);
  if (token.length < 10 || token.length > 500) return null;

  const ip = getClientIp(req);

  // Try JWT first (OAuth flow)
  if (token.includes('.')) {
    const secret = process.env.MCP_JWT_SECRET || process.env.CLERK_SECRET_KEY;
    if (!secret) return null; // No secret configured — cannot verify JWTs
    const JWT_SECRET = new TextEncoder().encode(secret);
    try {
      const { payload } = await jwtVerify(token, JWT_SECRET);
      if (payload.spaceId && typeof payload.spaceId === 'string') {
        return { spaceId: payload.spaceId, ip };
      }
    } catch {
      // Not a valid JWT — fall through to API key check
    }
  }

  // Fall back to raw API key hash lookup
  const keyHash = crypto.createHash('sha256').update(token).digest('hex');
  const { data } = await supabase
    .from('McpApiKey')
    .select('spaceId')
    .eq('keyHash', keyHash)
    .maybeSingle();

  if (!data) return null;

  supabase
    .from('McpApiKey')
    .update({ lastUsedAt: new Date().toISOString() })
    .eq('keyHash', keyHash)
    .then(({ error }) => { if (error) console.error('[mcp] lastUsedAt update failed:', error.message); });

  return { spaceId: data.spaceId, ip };
}

function asText(value: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Build an McpServer scoped to a given spaceId (READ-ONLY tools)
// ---------------------------------------------------------------------------
function buildServer(spaceId: string): McpServer {
  const server = new McpServer({
    name: 'Charles',
    version: '1.0.0',
  });

  // ── get_mission ──
  server.tool(
    'get_mission',
    'Return the company mission, one-line pitch, target customer, stage, and core memory slots.',
    {},
    async () => {
      const [missionRes, coreRes] = await Promise.all([
        supabase
          .from('Mission')
          .select('title, oneLinePitch, targetCustomer, stage, description')
          .eq('spaceId', spaceId)
          .maybeSingle(),
        supabase
          .from('CoreMemory')
          .select('slot, value')
          .eq('spaceId', spaceId),
      ]);
      const core: Record<string, string | null> = {};
      for (const row of (coreRes.data ?? []) as Array<{ slot: string; value: string | null }>) {
        core[row.slot] = row.value;
      }
      return asText({
        mission: missionRes.data ?? null,
        core,
      });
    },
  );

  // ── list_departments ──
  server.tool(
    'list_departments',
    'List the six Charles departments with their current autonomy levels.',
    {},
    async () => {
      const autonomy = await getAllDepartmentAutonomy(spaceId);
      const departments = ALL_DEPARTMENTS.map((slug) => ({
        slug,
        name: DEPARTMENT_NAMES[slug],
        autonomyLevel: autonomy[slug],
      }));
      return asText({ departments });
    },
  );

  // ── get_current_stage ──
  server.tool(
    'get_current_stage',
    'Return the current workspace stage, its purpose, and the exit gates with completion status.',
    {},
    async () => {
      const { data: mission } = await supabase
        .from('Mission')
        .select('stage')
        .eq('spaceId', spaceId)
        .maybeSingle();
      const current = ((mission as { stage?: string } | null)?.stage ?? 'idea') as Stage;
      const def = STAGES[current] ?? STAGES.idea;

      const { data: gateRows } = await supabase
        .from('StageGate')
        .select('title, isComplete, completedAt')
        .eq('spaceId', spaceId)
        .eq('stage', current)
        .order('order', { ascending: true });

      const gates = def.gates.map((title) => {
        const row = (gateRows ?? []).find(
          (g) => (g as { title: string }).title === title,
        ) as { title: string; isComplete: boolean; completedAt: string | null } | undefined;
        return {
          title,
          isComplete: row?.isComplete ?? false,
          completedAt: row?.completedAt ?? null,
        };
      });

      return asText({
        slug: def.slug,
        label: def.label,
        purpose: def.purpose,
        gates,
      });
    },
  );

  // ── list_recent_runs ──
  server.tool(
    'list_recent_runs',
    'List recent agent runs across all departments. Cap 50.',
    {
      limit: z.number().int().positive().max(50).optional().default(20).describe('Max results (1-50)'),
    },
    async ({ limit }) => {
      const cap = Math.min(50, Math.max(1, limit ?? 20));
      const { data, error } = await supabase
        .from('SwarmMember')
        .select(
          'id, name, role, task, status, startedAt, completedAt, createdAt, swarmRun:SwarmRun!inner(spaceId)',
        )
        .eq('swarmRun.spaceId', spaceId)
        .order('createdAt', { ascending: false })
        .limit(cap);
      if (error) return asText({ error: 'Query failed' });
      const runs = (data ?? []).map((r: Record<string, unknown>) => {
        const startedAt = r.startedAt as string | null;
        const completedAt = r.completedAt as string | null;
        const durationMs =
          startedAt && completedAt
            ? new Date(completedAt).getTime() - new Date(startedAt).getTime()
            : null;
        const task = ((r.task as string | null) ?? '').slice(0, 120);
        return {
          id: r.id,
          name: r.name,
          department: r.role,
          task,
          status: r.status,
          durationMs,
          startedAt,
        };
      });
      return asText({ runs });
    },
  );

  // ── list_pending_approvals ──
  server.tool(
    'list_pending_approvals',
    'List pending drafts and paused runs awaiting founder approval.',
    {},
    async () => {
      const [drafts, paused] = await Promise.all([
        supabase
          .from('AgentDraft')
          .select('id, channel, subject, status, createdAt')
          .eq('spaceId', spaceId)
          .eq('status', 'pending')
          .order('createdAt', { ascending: false })
          .limit(50),
        supabase
          .from('AgentPausedRun')
          .select('id, status, createdAt, expiresAt')
          .eq('spaceId', spaceId)
          .eq('status', 'pending')
          .order('createdAt', { ascending: false })
          .limit(50),
      ]);
      return asText({
        drafts: (drafts.data ?? []).map((d: Record<string, unknown>) => ({
          id: d.id,
          channel: d.channel,
          summary: d.subject ?? `${d.channel} draft`,
          createdAt: d.createdAt,
        })),
        pausedRuns: (paused.data ?? []).map((p: Record<string, unknown>) => ({
          id: p.id,
          createdAt: p.createdAt,
          expiresAt: p.expiresAt,
        })),
      });
    },
  );

  // ── list_integrations ──
  server.tool(
    'list_integrations',
    'List active third-party integrations. No secrets are returned.',
    {},
    async () => {
      const { data, error } = await supabase
        .from('IntegrationConnection')
        .select('toolkit, label, createdAt')
        .eq('spaceId', spaceId)
        .eq('status', 'active')
        .order('createdAt', { ascending: false });
      if (error) return asText({ error: 'Query failed' });
      const integrations = (data ?? []).map((r: Record<string, unknown>) => ({
        toolkit: r.toolkit,
        label: r.label ?? null,
        connectedAt: r.createdAt,
      }));
      return asText({ integrations });
    },
  );

  // ── cost_rollup ──
  server.tool(
    'cost_rollup',
    'Per-day cost rollup grouped by department and model. Default 30 days, cap 90.',
    {
      days: z.number().int().positive().max(90).optional().default(30).describe('Days to include (1-90)'),
    },
    async ({ days }) => {
      const window = Math.min(90, Math.max(1, days ?? 30));
      const rows = await loadRollup(spaceId, window);
      let total = 0;
      const byDept: Record<string, number> = {};
      const byModel: Record<string, number> = {};
      const byDay: Record<string, number> = {};
      for (const r of rows) {
        total += r.totalCostUsd;
        byDept[r.department] = (byDept[r.department] ?? 0) + r.totalCostUsd;
        byModel[r.model] = (byModel[r.model] ?? 0) + r.totalCostUsd;
        byDay[r.day] = (byDay[r.day] ?? 0) + r.totalCostUsd;
      }
      return asText({
        days: window,
        totalUsd: Number(total.toFixed(4)),
        byDepartment: byDept,
        byModel,
        byDay,
      });
    },
  );

  // ── audit_feed ──
  server.tool(
    'audit_feed',
    'Recent audit events across runs, drafts, approvals, integrations, and stages.',
    {
      limit: z.number().int().positive().max(200).optional().default(50).describe('Max events (1-200)'),
      type: z
        .enum([
          'agent_run_started',
          'agent_run_completed',
          'agent_run_failed',
          'draft_created',
          'draft_accepted',
          'draft_declined',
          'paused_run_approved',
          'paused_run_declined',
          'integration_connected',
          'integration_disconnected',
          'stage_advanced',
          'gate_completed',
        ])
        .optional()
        .describe('Filter to one event type'),
    },
    async ({ limit, type }) => {
      const events = await loadAuditFeed(spaceId, {
        limit: Math.min(200, limit ?? 50),
        type,
      });
      return asText({ events });
    },
  );

  // ── recent_drafts ──
  server.tool(
    'recent_drafts',
    'Last 20 agent drafts, optionally filtered by status.',
    {
      status: z.enum(['pending', 'approved', 'dismissed', 'sent']).optional(),
    },
    async ({ status }) => {
      let q = supabase
        .from('AgentDraft')
        .select('id, channel, subject, status, createdAt, updatedAt')
        .eq('spaceId', spaceId)
        .order('updatedAt', { ascending: false })
        .limit(20);
      if (status) q = q.eq('status', status);
      const { data, error } = await q;
      if (error) return asText({ error: 'Query failed' });
      return asText({ drafts: data ?? [] });
    },
  );

  // ── workspace_health ──
  server.tool(
    'workspace_health',
    'First-load snapshot: stage, open gates, pending approvals, 7-day cost, active integrations.',
    {},
    async () => {
      const [missionRes, gatesRes, draftsRes, pausedRes, integrationsRes, rollup] = await Promise.all([
        supabase.from('Mission').select('stage').eq('spaceId', spaceId).maybeSingle(),
        supabase
          .from('StageGate')
          .select('*', { count: 'exact', head: true })
          .eq('spaceId', spaceId)
          .eq('isComplete', false),
        supabase
          .from('AgentDraft')
          .select('*', { count: 'exact', head: true })
          .eq('spaceId', spaceId)
          .eq('status', 'pending'),
        supabase
          .from('AgentPausedRun')
          .select('*', { count: 'exact', head: true })
          .eq('spaceId', spaceId)
          .eq('status', 'pending'),
        supabase
          .from('IntegrationConnection')
          .select('*', { count: 'exact', head: true })
          .eq('spaceId', spaceId)
          .eq('status', 'active'),
        loadRollup(spaceId, 7),
      ]);
      const stage = ((missionRes.data as { stage?: string } | null)?.stage ?? 'idea') as Stage;
      const last7Usd = rollup.reduce((sum, r) => sum + r.totalCostUsd, 0);
      return asText({
        stage,
        gatesRemaining: gatesRes.count ?? 0,
        pendingApprovals: (draftsRes.count ?? 0) + (pausedRes.count ?? 0),
        last7DaysCostUsd: Number(last7Usd.toFixed(4)),
        activeIntegrations: integrationsRes.count ?? 0,
      });
    },
  );

  return server;
}

// ---------------------------------------------------------------------------
// POST /api/mcp — Streamable HTTP MCP endpoint
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  // Rate limit by IP before auth to prevent brute-force
  const ip = getClientIp(req);
  const { allowed: ipAllowed } = await checkRateLimit(`mcp:ip:${ip}`, 60, 60);
  if (!ipAllowed) {
    return new Response(JSON.stringify({ error: 'Too many requests' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const BASE_URL = baseUrl();

  const authResult = await authenticateKey(req);
  if (!authResult) {
    return new Response(JSON.stringify({ error: 'invalid_token' }), {
      status: 401,
      headers: {
        'Content-Type': 'application/json',
        'WWW-Authenticate': `Bearer resource_metadata="${BASE_URL}/.well-known/oauth-protected-resource"`,
      },
    });
  }
  const { spaceId } = authResult;

  // Rate limit by space after auth
  const { allowed: spaceAllowed } = await checkRateLimit(`mcp:space:${spaceId}`, 120, 60);
  if (!spaceAllowed) {
    return new Response(JSON.stringify({ error: 'Too many requests' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const server = buildServer(spaceId);

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
    enableJsonResponse: true,
  });

  await server.connect(transport);

  try {
    const response = await transport.handleRequest(req as unknown as Request);
    return response;
  } catch (err: unknown) {
    console.error('[mcp] error:', err);
    return new Response(
      JSON.stringify({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal error' },
        id: null,
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}

// ---------------------------------------------------------------------------
// GET /api/mcp — required by MCP spec for SSE stream (return 405 in stateless)
// DELETE /api/mcp — session termination (no-op in stateless)
// ---------------------------------------------------------------------------
export async function GET(req: NextRequest) {
  const BASE_URL = baseUrl();

  // If no auth, return 401 with resource metadata link (MCP OAuth discovery)
  const auth = req.headers.get('authorization');
  if (!auth) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: {
        'Content-Type': 'application/json',
        'WWW-Authenticate': `Bearer resource_metadata="${BASE_URL}/.well-known/oauth-protected-resource"`,
      },
    });
  }

  // If auth provided, return 405 (no SSE in stateless mode)
  return new Response(JSON.stringify({ error: 'SSE not supported — use POST for JSON-RPC' }), {
    status: 405,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function DELETE() {
  return new Response(JSON.stringify({ error: 'Sessions not supported in stateless mode' }), {
    status: 405,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': 'https://claude.ai',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}
