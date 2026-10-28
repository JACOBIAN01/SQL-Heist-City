import { Scene } from 'three';
import { describe, expect, it } from 'vitest';
import type { GhostMessage } from '@heist/shared';
import { GhostRenderer } from './GhostRenderer';

const ghost: GhostMessage = {
  t: 'ghost',
  bank: 'bank-1',
  name: 'Ana',
  seconds: 2,
  take: 5000,
  mine: false,
  trace: { step: 1, points: [0, 0, 0, 10, 0, 0, 10, 0, 20] },
};

describe('GhostRenderer', () => {
  it('is out of sight until a ghost arrives', () => {
    const scene = new Scene();
    const g = new GhostRenderer(scene);
    g.update(0);
    expect(g.object.visible).toBe(false);
    expect(g.position(0)).toBeUndefined();
  });

  it('replays the run from the moment it starts, along its trace', () => {
    const g = new GhostRenderer(new Scene());
    g.start(ghost, 1000);
    g.update(1500);
    expect(g.object.visible).toBe(true);
    expect(g.object.position.x).toBeCloseTo(5);
    expect(g.position(2000)).toEqual({ x: 10, z: 0 });
    g.update(3000);
    expect(g.object.position.z).toBeCloseTo(20);
  });

  it('lingers a few seconds at the end, then goes', () => {
    const g = new GhostRenderer(new Scene());
    g.start(ghost, 0);
    g.update(5000);
    expect(g.object.visible).toBe(true);
    g.update(20_000);
    expect(g.object.visible).toBe(false);
  });

  it('can be stopped at once', () => {
    const g = new GhostRenderer(new Scene());
    g.start(ghost, 0);
    g.update(500);
    g.stop();
    expect(g.object.visible).toBe(false);
  });
});
