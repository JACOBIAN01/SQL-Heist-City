import { z } from 'zod';

/** A token bucket: up to `burst` at once, refilled at `perMinute`. */
const bucket = z.object({
  burst: z.number().int().min(1).max(100_000),
  perMinute: z.number().min(0.1).max(1_000_000),
});
export type BucketLimit = z.infer<typeof bucket>;

/**
 * Every rate limit in one place (Phase 18.2). Defaults only: operators override them with the
 * RATE_LIMITS environment variable (JSON, merged over these). Each has a test that exceeds it.
 */
// Per-address limits are sized for a whole class behind one school network address (up to 200
// students joining at once); finer limits are per account (failed logins, class-code guesses) or
// per connection.
export const rateLimitsSchema = z.object({
  /** New WebSocket connections per client address (game, challenge, practice, tutorial sockets). */
  connectionsPerIp: bucket.default({ burst: 400, perMinute: 1200 }),
  /** Messages per challenge, practice or assessment socket (JSON text). */
  challengeSocketMessages: bucket.default({ burst: 20, perMinute: 240 }),
  /** Requests to the game server's HTTP routes (lobby, class status, health, metrics) per address. */
  gameHttpPerIp: bucket.default({ burst: 400, perMinute: 2400 }),
  /** Admin API calls per address (staff only). */
  adminApiPerIp: bucket.default({ burst: 120, perMinute: 600 }),
  /** Error reports from browsers per address (a broken page must not flood the log). */
  clientErrorsPerIp: bucket.default({ burst: 30, perMinute: 60 }),
  /** Sign-in routes (staff login, Google sign-in, tickets, class join) per address. */
  authPerIp: bucket.default({ burst: 400, perMinute: 1200 }),
});
export type RateLimits = z.infer<typeof rateLimitsSchema>;
export const DEFAULT_RATE_LIMITS: RateLimits = rateLimitsSchema.parse({});

/** The defaults with an operator's JSON override on top; a bad override is reported, not ignored. */
export function rateLimitsFrom(json: string | undefined): RateLimits {
  if (!json) return DEFAULT_RATE_LIMITS;
  const raw = JSON.parse(json) as Record<string, unknown>;
  return rateLimitsSchema.parse({ ...DEFAULT_RATE_LIMITS, ...raw });
}
