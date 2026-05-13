/**
 * Server-side bridge: drain Convex liveMessages with
 * persistedToSupabase=false into Supabase TaskMessage rows, then flip
 * the flag. Idempotent — re-running can't double-write because each
 * Convex row carries the flag and we patch it inside the same loop.
 * Called from the every-10-minutes cron at /api/cron/audit-backfill.
 */

import { ConvexHttpClient } from 'convex/browser';
import { api as convexApi } from '@/convex/_generated/api';
import { supabase } from '@/lib/supabase';
import { logger } from '@/lib/logger';

interface UnpersistedRow {
  _id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  metadata?: Record<string, unknown> | null;
  createdAt: number;
}

export interface BackfillResult {
  persisted: number;
  failed: number;
}

const DEFAULT_LIMIT = 200;

export async function backfillUnpersistedMessages(): Promise<BackfillResult> {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  const secret = process.env.CONVEX_SERVICE_SECRET;
  if (!url || !secret) {
    logger.info('[audit-backfill] convex not configured; skipping');
    return { persisted: 0, failed: 0 };
  }

  const client = new ConvexHttpClient(url);

  let rows: UnpersistedRow[];
  try {
    rows = (await client.query(convexApi.liveMessagesServer.listUnpersisted, {
      serviceSecret: secret,
      limit: DEFAULT_LIMIT,
    })) as UnpersistedRow[];
  } catch (err) {
    logger.error('[audit-backfill] convex query failed', {
      err: err instanceof Error ? err.message : String(err),
    });
    return { persisted: 0, failed: 0 };
  }

  let persisted = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      // Look up whether Supabase already has a matching durable row for
      // this conversation + role + content + createdAt window. If so we
      // skip the insert (the route's dual-write path already covered
      // it) but still flip the flag so future runs ignore the row.
      const dupe = await findExistingTaskMessage(row);
      if (!dupe) {
        const { error } = await supabase.from('TaskMessage').insert({
          conversationId: row.conversationId,
          role: row.role,
          content: row.content,
          metadata: row.metadata ?? null,
          createdAt: new Date(row.createdAt).toISOString(),
        });
        if (error) {
          logger.warn('[audit-backfill] supabase insert failed', {
            err: error.message,
            convexId: row._id,
          });
          failed += 1;
          continue;
        }
      }

      await client.mutation(convexApi.liveMessagesServer.flagPersisted, {
        serviceSecret: secret,
        messageId: row._id as any,
      });
      persisted += 1;
    } catch (err) {
      logger.warn('[audit-backfill] row failed', {
        err: err instanceof Error ? err.message : String(err),
        convexId: row._id,
      });
      failed += 1;
    }
  }

  return { persisted, failed };
}

/**
 * Crude dedupe: same conversation, same role, same content, createdAt
 * within a five-second window. Cheap and correct enough — a real
 * collision would require the founder to send identical content twice
 * inside five seconds, which the route layer's optimistic UX prevents.
 */
async function findExistingTaskMessage(row: UnpersistedRow): Promise<boolean> {
  const lower = new Date(row.createdAt - 5_000).toISOString();
  const upper = new Date(row.createdAt + 5_000).toISOString();
  const { data, error } = await supabase
    .from('TaskMessage')
    .select('id')
    .eq('conversationId', row.conversationId)
    .eq('role', row.role)
    .eq('content', row.content)
    .gte('createdAt', lower)
    .lte('createdAt', upper)
    .limit(1);
  if (error) return false;
  return Array.isArray(data) && data.length > 0;
}
