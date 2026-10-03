import { describe, expect, it } from 'vitest';
import { LagCompensator } from './LagCompensator';

const pose = (x: number, height = 1.8) => ({ x, y: 0, z: 0, height });

describe('LagCompensator', () => {
  it('knows nothing about strangers', () => {
    expect(new LagCompensator(10).poseAt(1, 5)).toBeUndefined();
  });

  it('returns the exact record for a whole tick', () => {
    const lag = new LagCompensator(10);
    lag.record(1, 7, pose(10));
    lag.record(2, 7, pose(20));
    expect(lag.poseAt(7, 1)?.x).toBe(10);
    expect(lag.poseAt(7, 2)?.x).toBe(20);
  });

  it('blends between ticks', () => {
    const lag = new LagCompensator(10);
    lag.record(1, 7, pose(10, 1.8));
    lag.record(2, 7, pose(20, 1.1));
    expect(lag.poseAt(7, 1.5)?.x).toBe(15);
    expect(lag.poseAt(7, 1.25)?.height).toBe(1.8);
    expect(lag.poseAt(7, 1.75)?.height).toBe(1.1);
  });

  it('clamps outside the recorded range', () => {
    const lag = new LagCompensator(10);
    lag.record(5, 7, pose(50));
    lag.record(6, 7, pose(60));
    expect(lag.poseAt(7, 0)?.x).toBe(50);
    expect(lag.poseAt(7, 99)?.x).toBe(60);
  });

  it('keeps only the most recent ticks', () => {
    const lag = new LagCompensator(3);
    for (let t = 1; t <= 10; t++) lag.record(t, 7, pose(t * 10));
    expect(lag.poseAt(7, 1)?.x).toBe(80); // oldest kept is tick 8
  });

  it('keeps players separate and can forget one', () => {
    const lag = new LagCompensator(10);
    lag.record(1, 1, pose(1));
    lag.record(1, 2, pose(2));
    lag.forget(1);
    expect(lag.poseAt(1, 1)).toBeUndefined();
    expect(lag.poseAt(2, 1)?.x).toBe(2);
  });
});
