import { describe, expect, it } from 'vitest';
import { RateMeter } from './RateMeter';

describe('RateMeter', () => {
  it('is zero until it has two samples', () => {
    const m = new RateMeter();
    expect(m.perSecond).toBe(0);
    m.mark(0, 0);
    expect(m.perSecond).toBe(0);
  });

  it('reports the average rate per second', () => {
    const m = new RateMeter();
    m.mark(0, 0);
    m.mark(1000, 500);
    expect(m.perSecond).toBe(2000);
  });

  it('forgets samples older than the window so the rate follows recent traffic', () => {
    const m = new RateMeter(1000);
    m.mark(0, 0);
    m.mark(10_000, 1000); // a burst
    m.mark(10_100, 2000);
    m.mark(10_200, 3000);
    expect(m.perSecond).toBeLessThan(200);
  });
});
