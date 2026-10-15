import type { BucketLimit } from '@heist/shared';
import { TokenBucket } from './TokenBucket';

/**
 * One token bucket per key (a client address, a player), for limits that apply per client.
 * Idle buckets are dropped once there are many, so a flood of addresses cannot grow memory
 * without bound.
 */
export class KeyedLimiter {
  private readonly buckets = new Map<string, { bucket: TokenBucket; seen: number }>();

  constructor(
    private readonly limit: BucketLimit,
    private readonly now: () => number = Date.now,
    private readonly maxKeys = 50_000,
  ) {}

  take(key: string): boolean {
    let entry = this.buckets.get(key);
    if (!entry) {
      if (this.buckets.size >= this.maxKeys) this.prune();
      entry = {
        bucket: new TokenBucket(this.limit.burst, this.limit.perMinute / 60, this.now),
        seen: this.now(),
      };
      this.buckets.set(key, entry);
    }
    entry.seen = this.now();
    return entry.bucket.take();
  }

  /** Drops buckets idle long enough to have refilled (they would start full again anyway). */
  private prune(): void {
    const refillMs = (this.limit.burst / (this.limit.perMinute / 60)) * 1000;
    const cutoff = this.now() - refillMs;
    for (const [key, e] of this.buckets) if (e.seen < cutoff) this.buckets.delete(key);
    // Still full: everyone is active; drop the oldest half rather than refuse new clients.
    if (this.buckets.size >= this.maxKeys)
      [...this.buckets.keys()].slice(0, this.maxKeys / 2).forEach((k) => this.buckets.delete(k));
  }
}

/** A per-connection bucket from a limit. */
export const bucketFor = (limit: BucketLimit, now: () => number = Date.now): TokenBucket =>
  new TokenBucket(limit.burst, limit.perMinute / 60, now);
