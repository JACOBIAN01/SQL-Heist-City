import { describe, expect, it } from 'vitest';
import { SnapshotInterpolator, lerpAngle, type Pose } from './SnapshotInterpolator';

const pose = (x: number, over: Partial<Pose> = {}): Pose => ({
  x,
  y: 0,
  z: 0,
  yaw: 0,
  pitch: 0,
  flags: 0,
  hp: 100,
  ...over,
});

describe('lerpAngle', () => {
  it('takes the short way across the 0/2π seam', () => {
    const TAU = Math.PI * 2;
    const mid = lerpAngle(TAU - 0.2, 0.2, 0.5);
    expect(Math.cos(mid)).toBeCloseTo(1, 5);
    expect(Math.sin(mid)).toBeCloseTo(0, 5);
  });

  it('is the plain lerp when no wrap is involved', () => {
    expect(lerpAngle(1, 2, 0.25)).toBeCloseTo(1.25);
  });
});

describe('SnapshotInterpolator', () => {
  it('returns nothing when empty', () => {
    expect(new SnapshotInterpolator().sample(0)).toBeUndefined();
  });

  it('blends linearly between the two surrounding snapshots', () => {
    const i = new SnapshotInterpolator();
    i.push(0, pose(0));
    i.push(50, pose(10));
    i.push(100, pose(30));
    expect(i.sample(25)?.x).toBeCloseTo(5);
    expect(i.sample(75)?.x).toBeCloseTo(20);
  });

  it('holds the newest pose when time runs past the data, and the oldest before it', () => {
    const i = new SnapshotInterpolator();
    i.push(100, pose(1));
    i.push(150, pose(2));
    expect(i.sample(500)?.x).toBe(2);
    expect(i.sample(0)?.x).toBe(1);
    expect(i.sample(500)?.speed).toBe(0);
  });

  it('derives speed from the blended pair (m/s)', () => {
    const i = new SnapshotInterpolator();
    i.push(0, pose(0));
    i.push(50, pose(0.2)); // 0.2 m in 50 ms = 4 m/s
    expect(i.sample(25)?.speed).toBeCloseTo(4);
  });

  it('flips discrete state at the midpoint', () => {
    const i = new SnapshotInterpolator();
    i.push(0, pose(0, { flags: 1, hp: 100 }));
    i.push(100, pose(0, { flags: 2, hp: 60 }));
    expect(i.sample(40)).toMatchObject({ flags: 1, hp: 100 });
    expect(i.sample(60)).toMatchObject({ flags: 2, hp: 60 });
  });

  it('tracks how often updates arrive', () => {
    const i = new SnapshotInterpolator();
    expect(i.averageIntervalMs).toBe(0);
    for (let t = 0; t <= 1000; t += 200) i.push(t, pose(t));
    expect(i.averageIntervalMs).toBeCloseTo(200);
  });

  it('does not mistake a long silence for a slow update rate', () => {
    const i = new SnapshotInterpolator();
    i.push(0, pose(0));
    i.push(50, pose(1));
    i.push(60_000, pose(2));
    expect(i.averageIntervalMs).toBeCloseTo(50);
  });

  it('ignores out-of-order and duplicate snapshots', () => {
    const i = new SnapshotInterpolator();
    i.push(100, pose(1));
    i.push(50, pose(99));
    i.push(100, pose(98));
    expect(i.size).toBe(1);
  });

  it('prunes old history but always keeps two samples to blend', () => {
    const i = new SnapshotInterpolator(200);
    for (let t = 0; t <= 2000; t += 50) i.push(t, pose(t));
    expect(i.size).toBeLessThanOrEqual(6);
    expect(i.sample(1990)?.x).toBeCloseTo(1990);
    const sparse = new SnapshotInterpolator(10);
    sparse.push(0, pose(0));
    sparse.push(5000, pose(1));
    expect(sparse.size).toBe(2);
  });
});
