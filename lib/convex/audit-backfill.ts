/**
 * Drains Convex liveMessages with persistedToSupabase=false into the
 * Supabase TaskMessage table. Dedupe is deterministic: each Convex row
 * carries an _id, and TaskMessage.convexMessageId is UNIQUE, so we just
 * look up by id, INSERT if absent, and flag persisted. No heuristics.
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
  skipped: number;
  failed: number;
}

const DEFAULT_LIMIT = 200;

export async function backfillUnpersistedMessages(): Promise<BackfillResult> {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  const secret = process.env.CONVEX_SERVICE_SECRET;
  if (!url || !secret) {
    logger.info('[audit-backfill] convex not configured; skipping');
    return { persisted: 0, skipped: 0, failed: 0 };
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
    return { persisted: 0, skipped: 0, failed: 0 };
  }

  let persisted = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of rows) {
    let didInsert = false;
    let didSkip = false;
    try {
      const alreadyInSupabase = await hasTaskMessageByConvexId(row._id);

      if (alreadyInSupabase) {
        // Server dual-write (or a prior backfill) already inserted the
        // row. Skip the insert; just flip the flag so we stop seeing it.
        didSkip = true;
      } else {
        const { error } = await supabase.from('TaskMessage').insert({
          conversationId: row.conversationId,
          role: row.role,
          content: row.content,
          metadata: row.metadata ?? null,
          createdAt: new Date(row.createdAt).toISOString(),
          convexMessageId: row._id,
        });
        if (error) {
          logger.warn('[audit-backfill] supabase insert failed', {
            err: error.message,
            convexId: row._id,
          });
          failed += 1;
          continue;
        }
        didInsert = true;
      }

      await client.mutation(convexApi.liveMessagesServer.flagPersisted, {
        serviceSecret: secret,
        messageId: row._id as never,
      });
      if (didInsert) persisted += 1;
      else if (didSkip) skipped += 1;
    } catch (err) {
      logger.warn('[audit-backfill] row failed', {
        err: err instanceof Error ? err.message : String(err),
        convexId: row._id,
      });
      failed += 1;
    }
  }

  return { persisted, skipped, failed };
}

/**
 * Deterministic dedupe: does a TaskMessage row already carry this Convex
 * _id? Backed by the UNIQUE index on TaskMessage.convexMessageId. Returns
 * false on any error so the caller falls through to the insert path and
 * lets the DB's UNIQUE constraint do the final check.
 */
async function hasTaskMessageByConvexId(convexId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('TaskMessage')
    .select('id')
    .eq('convexMessageId', convexId)
    .limit(1);
  if (error) return false;
  return Array.isArray(data) && data.length > 0;
}
