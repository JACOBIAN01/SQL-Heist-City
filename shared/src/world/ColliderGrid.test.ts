import { describe, expect, it } from 'vitest';
import { SeededRng } from '../random/Rng';
import { ColliderGrid, colliderGridFor } from './ColliderGrid';
import { box, type Aabb, type GameMap, type MapBox } from './map';
import { rayAabb } from './rayAabb';
import { raycastMap } from './raycast';
import { SpatialGrid } from './SpatialGrid';

function city(seed: string, count = 300, half = 300): GameMap {
  const rng = new SeededRng(seed);
  const boxes: MapBox[] = Array.from({ length: count }, () =>
    box(
      'building',
      rng.int(-half, half),
      rng.int(-half, half),
      rng.int(2, 30),
      rng.int(2, 25),
      rng.int(2, 30),
      rng.int(0, 3),
    ),
  );
  // Walls just outside the edge, like the real maps.
  boxes.push(
    box('wall', 0, -half - 0.5, half * 2, 4, 1),
    box('wall', half + 0.5, 0, 1, 4, half * 2),
  );
  return { id: 'c', halfSize: half, boxes, spawns: [] };
}

const brute = (boxes: readonly Aabb[], o: number[], d: number[], max: number) => {
  let best: number | undefined;
  for (const b of boxes) {
    const t = rayAabb(
      o[0] as number,
      o[1] as number,
      o[2] as number,
      d[0] as number,
      d[1] as number,
      d[2] as number,
      b,
      max,
    );
    if (t !== undefined && (best === undefined || t < best)) best = t;
  }
  return best;
};

describe('ColliderGrid.query', () => {
  it('returns every box that overlaps the rectangle (never misses), each once', () => {
    const map = city('q');
    const grid = new ColliderGrid(map.boxes, map.halfSize);
    const rng = new SeededRng('rects');
    const out: Aabb[] = [];
    for (let i = 0; i < 500; i++) {
      const x = rng.int(-300, 300);
      const z = rng.int(-300, 300);
      const r = rng.int(1, 40);
      grid.query(x - r, z - r, x + r, z + r, out);
      expect(new Set(out).size).toBe(out.length);
      const expected = map.boxes.filter(
        (b) => b.minX < x + r && b.maxX > x - r && b.minZ < z + r && b.maxZ > z - r,
      );
      for (const b of expected) expect(out).toContain(b);
    }
  });

  it('only returns nearby boxes: a small query touches a tiny fraction of the map', () => {
    const map = city('few', 600);
    const out: Aabb[] = [];
    new ColliderGrid(map.boxes, map.halfSize).query(0, 0, 3, 3, out);
    expect(out.length).toBeLessThan(map.boxes.length / 20);
  });

  it('reuses the caller’s array and handles an empty map', () => {
    const out: Aabb[] = [box('wall', 0, 0, 1, 1, 1)];
    new ColliderGrid([], 50).query(-5, -5, 5, 5, out);
    expect(out).toHaveLength(0);
  });

  it('caches one grid per map', () => {
    const map = city('cache', 10);
    expect(colliderGridFor(map)).toBe(colliderGridFor(map));
  });
});

describe('ColliderGrid.raycast', () => {
  it('matches a brute-force scan on thousands of random rays', () => {
    const map = city('rays');
    const grid = new ColliderGrid(map.boxes, map.halfSize);
    const rng = new SeededRng('dirs');
    let hits = 0;
    for (let i = 0; i < 4000; i++) {
      const o = [rng.int(-290, 290), rng.next() * 3, rng.int(-290, 290)];
      const yaw = rng.next() * Math.PI * 2;
      const pitch = (rng.next() - 0.5) * 0.6;
      const d = [
        -Math.sin(yaw) * Math.cos(pitch),
        Math.sin(pitch),
        -Math.cos(yaw) * Math.cos(pitch),
      ];
      const max = rng.int(5, 200);
      const expected = brute(map.boxes, o, d, max);
      const got = grid.raycast(
        o[0] as number,
        o[1] as number,
        o[2] as number,
        d[0] as number,
        d[1] as number,
        d[2] as number,
        max,
      );
      if (expected === undefined) expect(got).toBeUndefined();
      else {
        hits++;
        expect(got).toBeCloseTo(expected, 6);
      }
    }
    expect(hits).toBeGreaterThan(200);
  });

  it('handles axis-aligned and vertical rays', () => {
    const map: GameMap = {
      id: 'a',
      halfSize: 50,
      boxes: [box('wall', 0, -10, 4, 4, 2)],
      spawns: [],
    };
    const grid = new ColliderGrid(map.boxes, 50);
    expect(grid.raycast(0, 1, 0, 0, 0, -1, 50)).toBeCloseTo(9);
    expect(grid.raycast(0, 10, -10, 0, -1, 0, 50)).toBeCloseTo(6);
    expect(grid.raycast(10, 1, 0, 1, 0, 0, 50)).toBeUndefined();
  });

  it('raycastMap still includes the ground plane', () => {
    const map = city('g', 5);
    expect(raycastMap(map, 299, 2, 299, 0, -1, 0, 10)).toBeCloseTo(2);
  });
});

describe('SpatialGrid', () => {
  it('finds entities near a point and follows them as they move', () => {
    const g = new SpatialGrid(64);
    g.set(1, 10, 10);
    g.set(2, 500, 500);
    const near = (x: number, z: number, r: number) => {
      const found: number[] = [];
      g.forEachNear(x, z, r, (id) => found.push(id));
      return found.sort();
    };
    expect(near(0, 0, 30)).toEqual([1]);
    expect(near(500, 500, 30)).toEqual([2]);
    g.set(1, 520, 510);
    expect(near(500, 500, 70)).toEqual([1, 2]);
    expect(near(0, 0, 30)).toEqual([]);
  });

  it('removes entities and tolerates negative coordinates and unknown ids', () => {
    const g = new SpatialGrid(64);
    g.set(7, -200, -300);
    g.remove(7);
    g.remove(99);
    const found: number[] = [];
    g.forEachNear(-200, -300, 10, (id) => found.push(id));
    expect(found).toEqual([]);
    expect(g.size).toBe(0);
  });

  it('keeps moves inside one cell cheap and correct', () => {
    const g = new SpatialGrid(64);
    g.set(1, 1, 1);
    g.set(1, 2, 2);
    expect(g.size).toBe(1);
  });
});
