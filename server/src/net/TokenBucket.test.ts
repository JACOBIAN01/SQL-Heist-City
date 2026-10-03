import { describe, expect, it } from 'vitest';
import { TokenBucket } from './TokenBucket';

describe('TokenBucket', () => {
  it('allows a burst then refuses, then refills over time', () => {
    let t = 0;
    const bucket = new TokenBucket(3, 2, () => t);
    expect([bucket.take(), bucket.take(), bucket.take(), bucket.take()]).toEqual([
      true,
      true,
      true,
      false,
    ]);
    t = 500; // 1 token back
    expect(bucket.take()).toBe(true);
    expect(bucket.take()).toBe(false);
  });

  it('never holds more than its capacity', () => {
    let t = 0;
    const bucket = new TokenBucket(2, 100, () => t);
    t = 60_000;
    expect([bucket.take(), bucket.take(), bucket.take()]).toEqual([true, true, false]);
  });
});
