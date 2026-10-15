import { rateLimitsFrom, type BucketLimit } from '@heist/shared';
import type { WebSocket } from 'ws';
import { CLOSE_RATE_LIMITED } from '../game/Match';
import { bucketFor } from './KeyedLimiter';

/**
 * A per-connection message limit for the JSON sockets (challenge, practice, assessment). Over
 * it, the socket is closed: a client that floods is not one worth answering (Phase 18.2).
 */
export function messageLimit(
  socket: WebSocket,
  limit: BucketLimit = rateLimitsFrom(process.env.RATE_LIMITS).challengeSocketMessages,
  now: () => number = Date.now,
): () => boolean {
  const bucket = bucketFor(limit, now);
  return () => {
    if (bucket.take()) return true;
    socket.close(CLOSE_RATE_LIMITED, 'Too many messages');
    return false;
  };
}
