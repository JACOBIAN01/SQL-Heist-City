import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ATMOSPHERE_SETTINGS,
  mapById,
  type AtmosphereSettings,
  type CityLayout,
} from '@heist/shared';
import { CrowdModel, pointOn, ringOf } from './CrowdModel';

const city = mapById('city')?.city as CityLayout;
const settings =
  (over: Partial<AtmosphereSettings['crowd']> = {}) =>
  () => ({ ...DEFAULT_ATMOSPHERE_SETTINGS.crowd, ...over });
const all = (c: CrowdModel) => [...c.near({ x: 0, z: 0 }, 10_000)];

describe('rings', () => {
  const ring = ringOf({ minX: 0, minZ: 0, maxX: 20, maxZ: 10 }, 1);
  it('is the outline pulled in, and walks it round and back to the start', () => {
    expect(ring.length).toBeCloseTo(2 * (18 + 8));
    expect(pointOn(ring, 0)).toMatchObject({ x: 1, z: 1 });
    expect(pointOn(ring, 18)).toMatchObject({ x: 19, z: 1 });
    expect(pointOn(ring, ring.length).x).toBeCloseTo(1);
    expect(pointOn(ring, -1).z).toBeCloseTo(2); // wraps backwards up the last side
  });

  it('faces along the side being walked', () => {
    expect(pointOn(ring, 5).heading).toBeCloseTo(Math.PI / 2); // along +x
    expect(pointOn(ring, 20).heading).toBeCloseTo(0); // along +z
  });
});

describe('CrowdModel', () => {
  it('puts the asked number of people on the sidewalks, the same every time for a city', () => {
    const a = new CrowdModel(city, settings({ count: 120 }), 'x');
    expect(a.size).toBe(120);
    expect(all(a).map((p) => [p.x, p.z])).toEqual(
      all(new CrowdModel(city, settings({ count: 120 }), 'x')).map((p) => [p.x, p.z]),
    );
    expect(all(new CrowdModel(city, settings({ count: 120 }), 'y')).map((p) => p.x)).not.toEqual(
      all(a).map((p) => p.x),
    );
    expect(new CrowdModel(city, settings({ count: 0 }), 'x').size).toBe(0);
  });

  it('keeps everyone on a sidewalk ring of a block, never in the road or inside a building', () => {
    const crowd = new CrowdModel(city, settings({ count: 200 }), 'x');
    crowd.update(30);
    const inset = city.settings.sidewalkWidth / 2;
    for (const p of all(crowd)) {
      const onRing = city.blocks.some((b) => {
        const r = b.outer;
        const inside =
          p.x >= r.minX + inset - 1e-6 &&
          p.x <= r.maxX - inset + 1e-6 &&
          p.z >= r.minZ + inset - 1e-6 &&
          p.z <= r.maxZ - inset + 1e-6;
        const onEdge =
          Math.abs(p.x - (r.minX + inset)) < 1e-6 ||
          Math.abs(p.x - (r.maxX - inset)) < 1e-6 ||
          Math.abs(p.z - (r.minZ + inset)) < 1e-6 ||
          Math.abs(p.z - (r.maxZ - inset)) < 1e-6;
        return inside && onEdge;
      });
      expect(onRing, `${p.x},${p.z}`).toBe(true);
    }
  });

  it('strolls at walking pace', () => {
    const crowd = new CrowdModel(city, settings({ count: 1 }), 'x');
    const [before] = all(crowd);
    crowd.update(1);
    const [after] = all(crowd);
    const moved = Math.hypot(
      (after?.x ?? 0) - (before?.x ?? 0),
      (after?.z ?? 0) - (before?.z ?? 0),
    );
    expect(moved).toBeGreaterThan(0.5);
    expect(moved).toBeLessThan(2.1); // walkSpeed × pace, never a run
  });

  it('runs away from a shot it can hear, faster, then goes back to strolling', () => {
    const crowd = new CrowdModel(
      city,
      settings({ count: 60, hearRadius: 400, fleeSeconds: 5 }),
      'x',
    );
    const start = all(crowd);
    const shot = { x: start[0]?.x ?? 0, z: start[0]?.z ?? 0 };
    crowd.alarm(shot.x, shot.z);
    expect(all(crowd).every((p) => p.fleeing)).toBe(true);
    const dist = (c: CrowdModel) => all(c).map((p) => Math.hypot(p.x - shot.x, p.z - shot.z));
    const before = dist(crowd);
    crowd.update(1);
    const after = dist(crowd);
    // Most people are further from the shot after a second of running.
    const further = after.filter((d, i) => d > (before[i] ?? 0)).length;
    expect(further).toBeGreaterThan(after.length * 0.6);
    crowd.update(10);
    expect(all(crowd).some((p) => p.fleeing)).toBe(false);
  });

  it('ignores a shot too far away to hear', () => {
    const crowd = new CrowdModel(city, settings({ count: 50, hearRadius: 10 }), 'x');
    crowd.alarm(1e6, 1e6);
    expect(all(crowd).some((p) => p.fleeing)).toBe(false);
  });

  it('lists only the people near the viewer', () => {
    const crowd = new CrowdModel(city, settings({ count: 300 }), 'x');
    const here = { x: 0, z: 0 };
    const near = [...crowd.near(here, 60)];
    expect(near.length).toBeLessThan(300);
    for (const p of near) expect(Math.hypot(p.x, p.z)).toBeLessThanOrEqual(60);
  });
});
