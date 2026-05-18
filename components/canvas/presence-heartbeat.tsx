'use client';

/**
 * PresenceHeartbeat — a render-nothing client component whose only job is
 * to keep the founder's presence row alive on a surface that's otherwise
 * a server component. Drop one into any page tree that needs to show up
 * in the top-bar avatar pills with the correct surface label.
 *
 * Optionally accepts a typingConversationId so callers in task-chat
 * trees can promote the heartbeat into the typing-indicator channel.
 */

import { usePresence } from '@/lib/convex/use-presence';

interface Props {
  spaceId: string;
  typingConversationId?: string;
}

export function PresenceHeartbeat({ spaceId, typingConversationId }: Props) {
  usePresence({ spaceId, typingConversationId });
  return null;
}
