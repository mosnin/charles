/**
 * Scheduled maintenance for the Convex live-state layer.
 *
 * Convex tables grow forever without a sweeper. These three crons keep
 * presence, canvasActivity, and liveMessages bounded. Each target
 * mutation caps its work so a single run fits inside the Convex
 * mutation timeout.
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

export default crons;
