/**
 * Scheduled maintenance for the Convex live-state layer.
 *
 * Convex tables grow forever without a sweeper. These crons keep
 * presence, canvasActivity, liveMessages, and realtimeTicks bounded.
 * Each target mutation caps its work so a single run fits inside the
 * Convex mutation timeout.
 */
import { cronJobs } from 'convex/server';
import { internal } from './_generated/api';

const crons = cronJobs();

crons.interval(
  'reap inactive presence',
  { minutes: 2 },
  internal.presence.reapInactive,
);

crons.interval(
  'cleanup expired canvas activity',
  { minutes: 5 },
  internal.canvasActivity.cleanup,
);

crons.interval(
  'prune old persisted live messages',
  { minutes: 60 },
  internal.liveMessagesServer.prunePersisted,
);

crons.interval(
  'cleanup expired realtime ticks',
  { minutes: 15 },
  internal.realtimeTicks.cleanup,
);

export default crons;
