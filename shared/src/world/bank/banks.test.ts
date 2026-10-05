import { describe, expect, it } from 'vitest';
import { DEFAULT_MOVEMENT_SETTINGS } from '../../config/movement';
import { SIM_DT } from '../../sim/input';
import { createBody, stepBody, type BodyState } from '../../sim/movement';
import type { GameMap, MapBox } from '../map';
import { mapWithClosedDoors } from '../variant';
import type { BankLayout } from './BankLayout';
import { BANK_2 } from './bank2';
import { BANK_LAYOUTS, bankFootprint } from './banks';
import { compileBankWorld, validateBank } from './compileBank';

/** One bank alone on open ground, as the city places it (front door toward +z). */
function lone(layout: BankLayout): GameMap {
  const world = compileBankWorld(layout, { x: 0, z: 0 });
  return {
    id: `lone-${layout.id}`,
    halfSize: 80,
    boxes: world.boxes,
    spawns: [],
    anchors: world.anchors,
    doors: world.doors,
    vaults: world.vaults,
  };
}

const forward = (seq: number, yaw: number) => ({
  seq,
  moveX: 0,
  moveY: 127,
  yaw,
  pitch: 0,
  buttons: 0,
  viewLagMs: 0,
});

/** Steers a body through waypoints (x, z) with the real movement code. */
function route(map: GameMap, points: readonly (readonly [number, number])[], from: BodyState) {
  const body = from;
  let seq = 0;
  for (const [tx, tz] of points) {
    for (let i = 0; i < 60 * 12; i++) {
      const dx = tx - body.x;
      const dz = tz - body.z;
      if (Math.hypot(dx, dz) < 0.3) break;
      stepBody(body, forward(seq++, Math.atan2(-dx, -dz)), SIM_DT, map, DEFAULT_MOVEMENT_SETTINGS);
    }
  }
  return body;
}

const solidAt = (boxes: readonly MapBox[], x: number, y: number, z: number) =>
  boxes.some(
    (b) => x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ && y > b.minY && y < b.maxY,
  );

describe.each([...BANK_LAYOUTS.values()].map((b) => [b.name, b] as const))(
  'every bank: %s',
  (_name, layout) => {
    const map = lone(layout);
    const vault = map.vaults?.[0];
    const console_ = map.anchors?.find((a) => a.id === vault?.consoleId);
    const door = map.doors?.[0];

    it('is a valid layout whose tier matches its place in the table', () => {
      expect(() => validateBank(layout)).not.toThrow();
      expect(BANK_LAYOUTS.get(layout.tier)).toBe(layout);
      expect(bankFootprint(layout.tier)).toEqual({ width: layout.width, depth: layout.depth });
    });

    it('fits a city lot (the default city leaves room for 28 × 28 m)', () => {
      expect(layout.width).toBeLessThanOrEqual(28);
      expect(layout.depth).toBeLessThanOrEqual(28);
    });

    it('has one vault with a console, and a lift on every storey, all on free floor', () => {
      expect(map.vaults).toHaveLength(1);
      expect(console_).toBeDefined();
      const lifts = map.anchors?.filter((a) => a.kind === 'elevator') ?? [];
      expect(lifts.map((l) => l.storey).sort()).toEqual(
        Array.from({ length: layout.storeys }, (_, i) => i),
      );
      for (const a of map.anchors ?? [])
        expect(solidAt(map.boxes, a.x, a.y + 1, a.z), a.id).toBe(false);
    });

    it('puts every loot spot on the vault storey, on free floor', () => {
      for (const spot of vault?.loot ?? []) {
        expect(spot.y).toBe(console_?.y);
        expect(solidAt(map.boxes, spot.x, spot.y + 0.5, spot.z)).toBe(false);
      }
    });

    it('seals the vault with its door, and opens it when the door goes', () => {
      if (!console_ || !door || !vault) throw new Error('no vault');
      const doorX = (door.box.minX + door.box.maxX) / 2;
      const doorZ = (door.box.minZ + door.box.maxZ) / 2;
      // From the console straight through the doorway to 3 m past it.
      const dx = doorX - console_.x;
      const dz = doorZ - console_.z;
      const len = Math.hypot(dx, dz);
      const past: [number, number] = [doorX + (dx / len) * 3, doorZ + (dz / len) * 3];
      const walk = (doors: string[]) =>
        route(
          mapWithClosedDoors(map, doors),
          [past],
          createBody(console_.x, console_.y, console_.z),
        );
      const shut = walk([door.id]);
      expect(Math.hypot(shut.x - past[0], shut.z - past[1])).toBeGreaterThan(2);
      const open = walk([]);
      expect(Math.hypot(open.x - past[0], open.z - past[1])).toBeLessThan(0.5);
    });
  },
);

describe('Bank 2 "Harbor Trust"', () => {
  const map = lone(BANK_2);
  const outside = () => createBody(0, 0, 18);
  // In by the front door, round the pillars and the counter, to the foot of the stairs.
  const toStairs: [number, number][] = [
    [0, 8],
    [-11, 8],
    [-11, -3], // foot of flight 1 (lane A)
  ];
  const toStorey1: [number, number][] = [...toStairs, [-11, -10]]; // the landing
  const toStorey2: [number, number][] = [
    ...toStorey1,
    [-9.6, -10.2],
    [-8.5, -10.2], // foot of flight 2 (lane B)
    [-8.5, -4],
  ];
  const toStorey3: [number, number][] = [
    ...toStorey2,
    [-8.5, -3],
    [-11, -3], // foot of flight 3 (lane A again)
    [-11, -10],
  ];

  it('climbs storey by storey to the top', () => {
    expect(route(map, toStorey1, outside()).y).toBeCloseTo(3, 1);
    expect(route(map, toStorey2, outside()).y).toBeCloseTo(6, 1);
    expect(route(map, toStorey3, outside()).y).toBeCloseTo(9, 1);
  });

  it('reaches the vault console from the top of the stairs', () => {
    const body = route(map, [...toStorey3, [-8, -3], [1.4, -3], [1.4, -6.8]], outside());
    expect(body.y).toBeCloseTo(9, 1);
    expect(Math.hypot(body.x - 1.4, body.z + 6.8)).toBeLessThan(0.5);
  });

  it('lets staff through the gap in the counter, and stops everyone else at it', () => {
    const atCounter = route(
      map,
      [
        [0, 3],
        [3.5, -6],
      ],
      outside(),
    );
    expect(atCounter.z).toBeGreaterThan(-0.5);
    expect(atCounter.z).toBeLessThan(0);
    const throughGap = route(map, [[0, -6]], outside());
    expect(throughGap.z).toBeCloseTo(-6, 0);
  });

  it('reaches the front offices of the middle storeys through a partition door', () => {
    const lift1 = map.anchors?.find((a) => a.id === 'bank-2:lift:1');
    const body = route(map, [...toStorey2.slice(0, 4), [-6, -1], [0, -1], [0, 5]], outside());
    expect(body.y).toBeCloseTo(3, 1);
    expect(body.z).toBeGreaterThan(4);
    expect(lift1).toMatchObject({ x: 11, z: 7, y: 3 });
  });
});
