import { describe, expect, it } from 'vitest';
import { GameLoop, TickStats, type Scheduler } from './GameLoop';

/** A manual clock: time only moves when the test says so. */
class FakeScheduler implements Scheduler {
  time = 0;
  private pending: { at: number; callback: () => void } | undefined;
  now = () => this.time;
  after = (ms: number, callback: () => void) => {
    this.pending = { at: this.time + ms, callback };
    return () => {
      this.pending = undefined;
    };
  };
  /** Advance to the next scheduled callback and run it. Returns false if none. */
  fire(): boolean {
    const next = this.pending;
    if (!next) return false;
    this.pending = undefined;
    this.time = Math.max(this.time, next.at);
    next.callback();
    return true;
  }
}

describe('GameLoop', () => {
  it('fires on a fixed timeline', () => {
    const clock = new FakeScheduler();
    const times: number[] = [];
    const loop = new GameLoop(50, () => times.push(clock.time), clock);
    loop.start();
    for (let i = 0; i < 4; i++) clock.fire();
    expect(times).toEqual([50, 100, 150, 200]);
  });

  it('corrects for slow ticks instead of drifting', () => {
    const clock = new FakeScheduler();
    const times: number[] = [];
    let slow = true;
    const loop = new GameLoop(
      50,
      () => {
        times.push(clock.time);
        if (slow) clock.time += 30; // first tick takes 30 ms
        slow = false;
      },
      clock,
    );
    loop.start();
    clock.fire();
    clock.fire();
    clock.fire();
    expect(times).toEqual([50, 100, 150]);
  });

  it('skips ahead after a long stall rather than bursting', () => {
    const clock = new FakeScheduler();
    const times: number[] = [];
    let stalled = false;
    const loop = new GameLoop(
      50,
      () => {
        times.push(clock.time);
        if (!stalled) {
          stalled = true;
          clock.time += 5000;
        }
      },
      clock,
    );
    loop.start();
    clock.fire();
    clock.fire();
    expect(times[1]).toBeGreaterThanOrEqual(5050);
    expect(times).toHaveLength(2);
  });

  it('stops', () => {
    const clock = new FakeScheduler();
    let ticks = 0;
    const loop = new GameLoop(50, () => ticks++, clock);
    loop.start();
    clock.fire();
    loop.stop();
    expect(clock.fire()).toBe(false);
    expect(ticks).toBe(1);
  });

  it('records how long each tick took', () => {
    const clock = new FakeScheduler();
    const loop = new GameLoop(50, () => (clock.time += 4), clock);
    loop.start();
    clock.fire();
    clock.fire();
    expect(loop.stats.count).toBe(2);
    expect(loop.stats.max).toBe(4);
  });
});

describe('TickStats', () => {
  it('reports percentiles and keeps a sliding window', () => {
    const stats = new TickStats(100);
    for (let i = 1; i <= 100; i++) stats.record(i);
    expect(stats.percentile(50)).toBe(51);
    expect(stats.percentile(95)).toBe(96);
    stats.record(1000);
    expect(stats.count).toBe(100);
    expect(stats.max).toBe(1000);
  });

  it('is zero when empty', () => {
    expect(new TickStats().percentile(99)).toBe(0);
  });
});
