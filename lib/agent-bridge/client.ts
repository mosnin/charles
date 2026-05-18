/**
 * Client for the Python Modal "bridge" endpoints.
 *
 * These four primitives wrap the manager-side tool surface in
 * agent/web/bridge.py — they're how the Next.js chat triggers a real
 * department delegation without spinning up the conversational agent loop.
 *
 * Auth: Bearer token in the Authorization header. The shared secret is
 * `MODAL_BRIDGE_SECRET` (falls back to `AGENT_INTERNAL_SECRET` so a single
 * env var can drive both the existing webhook and these endpoints in dev).
 *
 * Env vars (read lazily — module load must not throw if they're absent):
 *   MODAL_BRIDGE_URL_DELEGATE
 *   MODAL_BRIDGE_URL_ADVANCE_STAGE
 *   MODAL_BRIDGE_URL_GET_MISSION
 *   MODAL_BRIDGE_URL_UPDATE_CORE_MEMORY
 *   MODAL_BRIDGE_URL          — optional. If set, each per-endpoint URL
 *                                falls back to `${MODAL_BRIDGE_URL}/<label>`
 *                                so one var can configure all four.
 *   MODAL_BRIDGE_SECRET       — required for ANY call to succeed.
 *
 * Errors thrown here are intentionally explicit:
 *   - BridgeConfigError  — env vars missing
 *   - BridgeAuthError    — 401 from Modal (secret mismatch)
 *   - BridgeHttpError    — any other non-2xx
 */

export type Department =
  | 'engineering'
  | 'sales'
  | 'marketing'
  | 'design'
  | 'support'
  | 'ops_finance';

export const DEPARTMENTS: readonly Department[] = [
  'engineering',
  'sales',
  'marketing',
  'design',
  'support',
  'ops_finance',
] as const;

export interface DelegateArgs {
  spaceId: string;
  runId?: string;
  department: Department;
  task: string;
  context?: string;
}

export interface DelegateResult {
  output: string;
  status: 'completed' | 'failed';
  swarmMemberId?: string;
  department: Department;
}

export interface AdvanceStageArgs {
  spaceId: string;
  newStage: string;
  reason?: string;
}

export interface AdvanceStageResult {
  output: string;
  status: 'completed' | 'failed' | 'blocked';
  stage: string | null;
}

export interface GetMissionResult {
  mission: Record<string, unknown> | null;
  core: Record<string, string | null>;
  promptBlock?: string;
}

export interface UpdateCoreMemoryArgs {
  spaceId: string;
  slot: string;
  value: string;
}

export interface UpdateCoreMemoryResult {
  ok: boolean;
  slot: string;
  value: string;
}

export class BridgeConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BridgeConfigError';
  }
}

export class BridgeAuthError extends Error {
  constructor(message = 'Unauthorized') {
    super(message);
    this.name = 'BridgeAuthError';
  }
}

export class BridgeHttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'BridgeHttpError';
    this.status = status;
  }
}

type EndpointKey = 'delegate' | 'advance-stage' | 'get-mission' | 'update-core-memory';

function endpointUrl(key: EndpointKey): string {
  const envKey = (
    {
      'delegate': 'MODAL_BRIDGE_URL_DELEGATE',
      'advance-stage': 'MODAL_BRIDGE_URL_ADVANCE_STAGE',
      'get-mission': 'MODAL_BRIDGE_URL_GET_MISSION',
      'update-core-memory': 'MODAL_BRIDGE_URL_UPDATE_CORE_MEMORY',
    } as const
  )[key];

  const explicit = process.env[envKey];
  if (explicit) return explicit;

  const base = process.env.MODAL_BRIDGE_URL;
  if (base) {
    const stripped = base.replace(/\/+$/, '');
    return `${stripped}/bridge-${key}`;
  }

  throw new BridgeConfigError(
    `Bridge URL not configured. Set ${envKey} or MODAL_BRIDGE_URL.`,
  );
}

function bridgeSecret(): string {
  const secret = process.env.MODAL_BRIDGE_SECRET || process.env.AGENT_INTERNAL_SECRET;
  if (!secret) {
    throw new BridgeConfigError(
      'MODAL_BRIDGE_SECRET (or AGENT_INTERNAL_SECRET) is not set.',
    );
  }
  return secret;
}

async function postJson<T>(key: EndpointKey, body: unknown): Promise<T> {
  const url = endpointUrl(key);
  const secret = bridgeSecret();

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify(body ?? {}),
    });
  } catch (err) {
    throw new BridgeHttpError(
      0,
      `Bridge fetch failed (${key}): ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (res.status === 401 || res.status === 403) {
    throw new BridgeAuthError(`Bridge rejected auth (${key}): ${res.status}`);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new BridgeHttpError(
      res.status,
      `Bridge ${key} returned ${res.status}: ${text.slice(0, 500)}`,
    );
  }
  return (await res.json()) as T;
}

export async function callDelegate(args: DelegateArgs): Promise<DelegateResult> {
  if (!(DEPARTMENTS as readonly string[]).includes(args.department)) {
    throw new BridgeConfigError(`Invalid department: ${args.department}`);
  }
  const raw = await postJson<{
    status: 'completed' | 'failed';
    output: string;
    swarmMemberId?: string | null;
    department: string;
  }>('delegate', {
    spaceId: args.spaceId,
    runId: args.runId,
    department: args.department,
    task: args.task,
    context: args.context,
  });
  return {
    status: raw.status,
    output: raw.output,
    swarmMemberId: raw.swarmMemberId ?? undefined,
    department: raw.department as Department,
  };
}

export async function callAdvanceStage(
  args: AdvanceStageArgs,
): Promise<AdvanceStageResult> {
  return postJson<AdvanceStageResult>('advance-stage', {
    spaceId: args.spaceId,
    newStage: args.newStage,
    reason: args.reason,
  });
}

export async function callGetMission(spaceId: string): Promise<GetMissionResult> {
  return postJson<GetMissionResult>('get-mission', { spaceId });
}

export async function callUpdateCoreMemory(
  args: UpdateCoreMemoryArgs,
): Promise<UpdateCoreMemoryResult> {
  return postJson<UpdateCoreMemoryResult>('update-core-memory', {
    spaceId: args.spaceId,
    slot: args.slot,
    value: args.value,
  });
}

export function isBridgeConfigured(): boolean {
  try {
    bridgeSecret();
  } catch {
    return false;
  }
  // We don't insist all four URLs are set — a single MODAL_BRIDGE_URL is enough.
  return Boolean(
    process.env.MODAL_BRIDGE_URL ||
      process.env.MODAL_BRIDGE_URL_DELEGATE ||
      process.env.MODAL_BRIDGE_URL_ADVANCE_STAGE ||
      process.env.MODAL_BRIDGE_URL_GET_MISSION ||
      process.env.MODAL_BRIDGE_URL_UPDATE_CORE_MEMORY,
  );
}
