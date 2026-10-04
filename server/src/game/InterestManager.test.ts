import { describe, expect, it } from 'vitest';
import { interestSettingsSchema } from '@heist/shared';
import { InterestManager, type Viewer } from './InterestManager';

const cfg = interestSettingsSchema.parse({});

function setup() {
  const manager = new InterestManager(cfg);
  const positions = new Map<number, { x: number; z: number }>();
  const place = (id: number, x: number, z: number) => {
    positions.set(id, { x, z });
    manager.update(id, x, z);
  };
  const viewer: Viewer = { id: 1, x: 0, z: 0, lastSent: new Map() };
  const pick = (tick: number) => {
    const out: number[] = [];
    manager.select(viewer, tick, (id) => positions.get(id), out);
    return out;
  };
  return { manager, place, viewer, pick, positions };
}

describe('InterestManager', () => {
  it('sends near players every tick, mid every 2nd, far every 4th, and nobody beyond range', () => {
    const { place, pick } = setup();
    place(2, 30, 0); // near
    place(3, 100, 0); // mid
    place(4, 200, 0); // far
    place(5, 400, 0); // out of range
    const seen = Array.from({ length: 8 }, (_, t) => pick(t + 1));
    expect(seen.filter((s) => s.includes(2))).toHaveLength(8);
    expect(seen.filter((s) => s.includes(3))).toHaveLength(4);
    expect(seen.filter((s) => s.includes(4))).toHaveLength(2);
    expect(seen.flat()).not.toContain(5);
  });

  it('never includes the viewer themselves', () => {
    const { place, pick } = setup();
    place(1, 0, 0);
    place(2, 10, 0);
    expect(pick(1)).toEqual([2]);
  });

  it('sends a newcomer straight away, whatever the tick phase', () => {
    const { place, pick } = setup();
    place(4, 200, 0);
    expect(pick(1)).toEqual([4]);
    expect(pick(2)).toEqual([]);
    place(6, 210, 0);
    expect(pick(3)).toEqual([6]); // new on a "quiet" tick
  });

  it('forgets players who leave range, and re-sends them at once if they return', () => {
    const { place, pick, viewer } = setup();
    place(4, 200, 0);
    expect(pick(1)).toEqual([4]);
    place(4, 600, 0);
    expect(pick(2)).toEqual([]);
    expect(viewer.lastSent.has(4)).toBe(false);
    place(4, 200, 0);
    expect(pick(3)).toEqual([4]);
  });

  it('keeps only the nearest when over the cap, nearest first', () => {
    const manager = new InterestManager({ ...cfg, maxEntities: 3 });
    const positions = new Map<number, { x: number; z: number }>();
    for (let id = 2; id <= 10; id++) {
      positions.set(id, { x: id * 5, z: 0 });
      manager.update(id, id * 5, 0);
    }
    const out: number[] = [];
    manager.select({ id: 1, x: 0, z: 0, lastSent: new Map() }, 1, (id) => positions.get(id), out);
    expect(out).toEqual([2, 3, 4]);
  });

  it('removes players from the grid', () => {
    const { manager, place, pick } = setup();
    place(2, 10, 0);
    manager.remove(2);
    expect(pick(1)).toEqual([]);
  });

  it('exposes who is near a point for event delivery', () => {
    const { place, manager } = setup();
    place(2, 10, 0);
    place(3, 500, 0);
    const found: number[] = [];
    manager.forEachNear(0, 0, 100, (id) => found.push(id));
    expect(found).toEqual([2]);
  });
});
