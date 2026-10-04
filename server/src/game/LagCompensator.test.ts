import { describe, expect, it } from 'vitest';
import { LagCompensator, type BodyPose } from './LagCompensator';

const at = (lag: LagCompensator, id: number, tick: number): BodyPose | undefined => {
  const out: BodyPose = { x: 0, y: 0, z: 0, height: 0 };
  return lag.poseAt(id, tick, out) ? out : undefined;
};
const rec = (lag: LagCompensator, tick: number, id: number, x: number, height = 1.8) =>
  lag.record(tick, id, x, 0, 0, height);

describe('LagCompensator', () => {
  it('knows nothing about strangers', () => {
    expect(at(new LagCompensator(10), 1, 5)).toBeUndefined();
  });

  it('returns the exact record for a whole tick', () => {
    const lag = new LagCompensator(10);
    rec(lag, 1, 7, 10);
    rec(lag, 2, 7, 20);
    expect(at(lag, 7, 1)?.x).toBe(10);
    expect(at(lag, 7, 2)?.x).toBe(20);
  });

  it('blends between ticks', () => {
    const lag = new LagCompensator(10);
    rec(lag, 1, 7, 10, 1.8);
    rec(lag, 2, 7, 20, 1.1);
    expect(at(lag, 7, 1.5)?.x).toBe(15);
    expect(at(lag, 7, 1.25)?.height).toBe(1.8);
    expect(at(lag, 7, 1.75)?.height).toBe(1.1);
  });

  it('clamps outside the recorded range', () => {
    const lag = new LagCompensator(10);
    rec(lag, 5, 7, 50);
    rec(lag, 6, 7, 60);
    expect(at(lag, 7, 0)?.x).toBe(50);
    expect(at(lag, 7, 99)?.x).toBe(60);
  });

  it('keeps only the most recent ticks, and still blends correctly after wrapping', () => {
    const lag = new LagCompensator(3);
    for (let t = 1; t <= 10; t++) rec(lag, t, 7, t * 10);
    expect(at(lag, 7, 1)?.x).toBe(80); // oldest kept is tick 8
    expect(at(lag, 7, 8.5)?.x).toBe(85);
    expect(at(lag, 7, 9.5)?.x).toBe(95);
    expect(at(lag, 7, 10)?.x).toBe(100);
  });

  it('keeps players separate and can forget one', () => {
    const lag = new LagCompensator(10);
    rec(lag, 1, 1, 1);
    rec(lag, 1, 2, 2);
    lag.forget(1);
    expect(at(lag, 1, 1)).toBeUndefined();
    expect(at(lag, 2, 1)?.x).toBe(2);
  });
});
