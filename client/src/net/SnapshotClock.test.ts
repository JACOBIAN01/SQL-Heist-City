import { describe, expect, it } from 'vitest';
import { SnapshotClock } from './SnapshotClock';

describe('SnapshotClock', () => {
  it('maps local time to server time using the least-delayed snapshot', () => {
    const clock = new SnapshotClock();
    expect(clock.ready).toBe(false);
    // 20 Hz: tick n = n*50 ms. Snapshots arrive 40–90 ms after they were made.
    clock.observe(1, 20, 1000 + 50 + 40);
    clock.observe(2, 20, 1000 + 100 + 90);
    clock.observe(3, 20, 1000 + 150 + 45);
    expect(clock.ready).toBe(true);
    // Best sample is the 40 ms one: server time = local − 1000 − 40.
    expect(clock.serverTimeAt(1090)).toBe(50);
    expect(clock.serverTimeAt(1190)).toBe(150);
  });

  it('forgets old samples so drift is followed', () => {
    const clock = new SnapshotClock(2);
    clock.observe(0, 20, 0); // offset 0
    clock.observe(1, 20, 100); // −50
    clock.observe(2, 20, 200); // −100
    expect(clock.serverTimeAt(300)).toBe(300 - 50);
  });
});
