'use client';

/**
 * Reactive task-chat hook. Streams messages from Convex liveMessages
 * for the given conversation; send() inserts the user message into
 * Convex AND fires the existing Supabase POST so the assistant reply
 * persists and dual-writes back to Convex. Degrades to fetch-only when
 * NEXT_PUBLIC_CONVEX_URL is unset (useQuery returns undefined).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  metadata?: Record<string, unknown> | null;
  createdAt: number;
}

interface UseTaskChatOpts {
  spaceId: string;
  conversationId: string | null;
  /** Seed used while Convex is still loading or unavailable. */
  initialMessages?: ChatMessage[];
}

interface ConvexLiveRow {
  _id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  metadata?: Record<string, unknown> | null;
  createdAt: number;
}

export interface UseTaskChatResult {
  messages: ChatMessage[];
  send: (content: string) => Promise<void>;
  isSending: boolean;
  /** True when the live stream is connected and serving rows. */
  isLive: boolean;
}

/**
 * Subscribes to Convex liveMessages for the conversation and exposes a
 * send() that inserts the user message into Convex while POSTing to the
 * existing Supabase-side endpoint so the assistant reply is generated
 * and dual-written. Falls back to the fetch-supplied initial messages
 * when Convex isn't configured.
 */
export function useTaskChat(opts: UseTaskChatOpts): UseTaskChatResult {
  const { spaceId, conversationId, initialMessages } = opts;

  // useQuery returns undefined while loading (or always, when Convex
  // isn't configured — the provider mounts without a client). We treat
  // undefined as "not live" and surface initialMessages instead.
  const liveRaw = useQuery(
    api.liveMessages.forConversation,
    conversationId ? { conversationId } : 'skip',
  ) as ConvexLiveRow[] | undefined;

  const sendToConvex = useMutation(api.liveMessages.send);
  const [isSending, setIsSending] = useState(false);
  const [fallbackMessages, setFallbackMessages] = useState<ChatMessage[]>(
    initialMessages ?? [],
  );

  // When initialMessages changes (e.g. conversation just got created and
  // the parent passed a different seed), reseed the fallback list.
  useEffect(() => {
    if (initialMessages) setFallbackMessages(initialMessages);
  }, [initialMessages]);

  const isLive = liveRaw !== undefined;

  const messages: ChatMessage[] = useMemo(() => {
    if (isLive) {
      return (liveRaw ?? []).map((r) => ({
        id: r._id,
        role: r.role,
        content: r.content,
        metadata: r.metadata ?? null,
        createdAt: r.createdAt,
      }));
    }
    return fallbackMessages;
  }, [isLive, liveRaw, fallbackMessages]);

  const send = useCallback(
    async (content: string) => {
      if (!conversationId) return;
      const text = content.trim();
      if (!text) return;
      setIsSending(true);
      try {
        // Fire-and-forget Convex insert in parallel with the POST. If
        // Convex isn't configured, useMutation still exists but the
        // call rejects; we swallow that and rely on the POST's
        // dual-write to catch up the stream once available.
        //
        // We resolve the returned _id but deliberately do NOT call
        // Supabase from the client to write convexMessageId — the
        // every-10-minutes audit-backfill cron handles that durably
        // via the UNIQUE index on TaskMessage.convexMessageId. This
        // preserves the "client-fast, audit-eventually" pattern.
        const convexPromise = sendToConvex({
          conversationId,
          spaceId,
          role: 'user',
          content: text,
        })
          .then((convexId) => convexId as string | undefined)
          .catch(() => undefined);

        const fetchPromise = fetch(
          `/api/task-conversations/${conversationId}/messages`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: text }),
          },
        ).then(async (res) => {
          if (!res.ok) throw new Error(`POST failed: ${res.status}`);
          return (await res.json()) as {
            user: { id: string; role: string; content: string; metadata: unknown; createdAt: string };
            assistant: { id: string; role: string; content: string; metadata: unknown; createdAt: string };
          };
        });

        const [, fetched] = await Promise.all([convexPromise, fetchPromise]);

        // Update the fallback list so the non-Convex path still shows
        // the new turn. When live, the reactive query already covers
        // this and the fallback list is unused.
        if (!isLive) {
          setFallbackMessages((prev) => [
            ...prev,
            toChatMessage(fetched.user),
            toChatMessage(fetched.assistant),
          ]);
        }
      } finally {
        setIsSending(false);
      }
    },
    [conversationId, spaceId, sendToConvex, isLive],
  );

  return { messages, send, isSending, isLive };
}

function toChatMessage(row: {
  id: string;
  role: string;
  content: string;
  metadata: unknown;
  createdAt: string;
}): ChatMessage {
  return {
    id: row.id,
    role: row.role as ChatMessage['role'],
    content: row.content,
    metadata: (row.metadata as Record<string, unknown> | null) ?? null,
    createdAt: new Date(row.createdAt).getTime(),
  };
}
