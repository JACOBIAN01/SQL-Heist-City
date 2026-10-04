import { describe, expect, it } from 'vitest';
import { DEFAULT_MOVEMENT_SETTINGS } from '../../config/movement';
import { SIM_DT } from '../../sim/input';
import { createBody, stepBody } from '../../sim/movement';
import { anchorInReach, nearestAnchor } from '../map';
import { mapWithClosedDoors } from '../variant';
import { HEIST_MAP } from '../heistMap';
import type { BankLayout } from './BankLayout';
import { BANK_1 } from './bank1';
import { compileAnchors, compileBank, validateBank } from './compileBank';

const forward = (seq: number, yaw: number, strafe = 0) => ({
  seq,
  moveX: strafe,
  moveY: 127,
  yaw,
  pitch: 0,
  buttons: 0,
  viewLagMs: 0,
});

/** Walks a body for `seconds`, returns where it ends up. */
function walk(x: number, z: number, yaw: number, seconds: number, strafe = 0) {
  const body = createBody(x, 0, z);
  for (let i = 0; i < seconds * 60; i++)
    stepBody(body, forward(i, yaw, strafe), SIM_DT, HEIST_MAP, DEFAULT_MOVEMENT_SETTINGS);
  return body;
}

const tiny: BankLayout = {
  id: 't',
  name: 't',
  tier: 1,
  width: 10,
  depth: 10,
  storeys: 1,
  storeyHeight: 3,
  entrance: { x: 0, width: 2, height: 2.4 },
  floors: [],
};

describe('compileBank', () => {
  it('cuts the entrance into the ground-floor front wall only', () => {
    const boxes = compileBank({ ...tiny, storeys: 2 }, { x: 0, z: 0 });
    const front = boxes.filter((b) => b.minZ > 4 && b.maxZ > 4.5 && b.maxX - b.minX < 10);
    // Two runs beside the door, a lintel over it, and a solid front wall on the upper storey.
    const doorway = front.filter((b) => b.minX < 0 && b.maxX > 0 && b.minY < 2.4);
    expect(doorway).toHaveLength(0);
    expect(front.some((b) => Math.abs(b.minY - 2.4) < 1e-9 && b.maxY === 3)).toBe(true);
  });

  it('offsets every box by the placement', () => {
    const a = compileBank(BANK_1, { x: 0, z: 0 });
    const b = compileBank(BANK_1, { x: 100, z: -40 });
    expect(b).toHaveLength(a.length);
    a.forEach((box, i) => {
      expect(b[i]?.minX).toBeCloseTo(box.minX + 100);
      expect(b[i]?.minZ).toBeCloseTo(box.minZ - 40);
    });
  });

  it('is deterministic and builds well-formed boxes', () => {
    const boxes = compileBank(BANK_1, { x: 0, z: 0 });
    expect(compileBank(BANK_1, { x: 0, z: 0 })).toEqual(boxes);
    for (const b of boxes) {
      expect(b.minX).toBeLessThan(b.maxX);
      expect(b.minY).toBeLessThan(b.maxY);
      expect(b.minZ).toBeLessThan(b.maxZ);
    }
  });

  it('roofs the building at its full height', () => {
    const top = Math.max(...compileBank(BANK_1, { x: 0, z: 0 }).map((b) => b.maxY));
    expect(top).toBeCloseTo(BANK_1.storeys * BANK_1.storeyHeight + 0.3);
  });
});

describe('validateBank', () => {
  const bad = (patch: Partial<BankLayout>) => () => validateBank({ ...tiny, ...patch });

  it('accepts the shipped bank', () => {
    expect(() => validateBank(BANK_1)).not.toThrow();
  });
  it('rejects an odd footprint', () => expect(bad({ width: 9 })).toThrow(/multiples of 2/));
  it('rejects an entrance off the facade', () =>
    expect(bad({ entrance: { x: 5, width: 2, height: 2 } })).toThrow(/outside the facade/));
  it('rejects a diagonal wall', () =>
    expect(
      bad({ floors: [{ blocks: [], walls: [{ from: { x: 0, z: 0 }, to: { x: 2, z: 2 } }] }] }),
    ).toThrow(/axis-aligned/));
  it('rejects overlapping openings', () =>
    expect(
      bad({
        floors: [
          {
            blocks: [],
            walls: [
              {
                from: { x: -4, z: 0 },
                to: { x: 4, z: 0 },
                openings: [
                  { at: 1, width: 2, height: 2 },
                  { at: 2, width: 2, height: 2 },
                ],
              },
            ],
          },
        ],
      }),
    ).toThrow(/overlapping/));
  it('rejects walls outside the footprint', () =>
    expect(
      bad({ floors: [{ blocks: [], walls: [{ from: { x: 0, z: 0 }, to: { x: 9, z: 0 } }] }] }),
    ).toThrow(/leaves the footprint/));
});

describe('Bank 1 on the heist map', () => {
  it('lets a player walk in through the front door', () => {
    const body = walk(0, 20, 0, 5);
    expect(body.z).toBeLessThan(0); // through the door and across the lobby, stopped by the counter
    expect(body.z).toBeGreaterThan(-1.2);
    expect(Math.abs(body.x)).toBeLessThan(1);
  });

  it('stops a player at the front wall away from the door', () => {
    const body = walk(8, 20, 0, 4);
    expect(body.z).toBeGreaterThan(9.2); // outside the 0.4 m wall at z = 9
  });

  it('stops a player at the back wall', () => {
    const body = walk(-6, 5, 0, 5);
    expect(body.z).toBeGreaterThan(-9);
  });

  it('keeps the vault room closed except by its staff door', () => {
    // Straight at the vault room's front wall (z = -1) from the lobby, away from the door at x ≈ 4.
    const blocked = walk(9, 4, 0, 3);
    expect(blocked.z).toBeGreaterThan(-1);
    // Through the staff door in the x = 4 wall.
    const through = walk(0, -5, -Math.PI / 2, 2);
    expect(through.x).toBeGreaterThan(5);
  });

  it('keeps every spawn clear of the bank', () => {
    for (const s of HEIST_MAP.spawns) expect(Math.hypot(s.x, s.z)).toBeGreaterThan(30);
  });
});

/** Steers a body through waypoints (x, z) with the real movement code; returns it when the last is reached. */
function route(points: readonly [number, number][], start: [number, number]) {
  const body = createBody(start[0], 0, start[1]);
  let seq = 0;
  for (const [tx, tz] of points) {
    for (let i = 0; i < 60 * 12; i++) {
      const dx = tx - body.x;
      const dz = tz - body.z;
      if (Math.hypot(dx, dz) < 0.3) break;
      const yaw = Math.atan2(-dx, -dz);
      stepBody(body, forward(seq++, yaw), SIM_DT, HEIST_MAP, DEFAULT_MOVEMENT_SETTINGS);
    }
  }
  return body;
}

describe('Bank 1 stairs', () => {
  const toLanding: [number, number][] = [
    [0, 6],
    [-10, 6],
    [-10, -1], // foot of flight 1
    [-10, -8], // landing against the back wall
  ];

  it('climbs the first flight to the second storey', () => {
    expect(route(toLanding, [0, 20]).y).toBeCloseTo(3, 1);
  });

  it('reaches the top storey', () => {
    const body = route(
      [
        ...toLanding,
        [-8.9, -8.3],
        [-7.5, -8.3], // foot of flight 2, one metre off the back wall
        [-7.5, -3],
      ],
      [0, 20],
    );
    expect(body.y).toBeCloseTo(6, 1);
  });

  it('leaves a hole in the slab where each flight arrives', () => {
    const boxes = compileBank(BANK_1, { x: 0, z: 0 });
    const slab1 = boxes.filter((b) => b.maxY === 3 && b.minY === 2.7);
    const covers = (x: number, z: number) =>
      slab1.some((b) => b.minX < x && b.maxX > x && b.minZ < z && b.maxZ > z);
    expect(covers(-10, -4)).toBe(false);
    expect(covers(-10, -8)).toBe(true); // the landing
    expect(covers(-10, 3)).toBe(true);
    expect(slab1.some((b) => b.minX < 0 && b.maxX > 0)).toBe(true);
  });

  it('rejects stairs too steep to walk or without a storey above', () => {
    const flight = {
      storey: 0,
      x: 0,
      z: 0,
      width: 2,
      heading: '+z' as const,
      steps: 6,
      tread: 0.4,
    };
    expect(() => validateBank({ ...tiny, storeys: 2, stairs: [flight] })).toThrow(/too tall/);
    expect(() => validateBank({ ...tiny, storeys: 1, stairs: [{ ...flight, steps: 12 }] })).toThrow(
      /no storey above/,
    );
  });
});

describe('anchors', () => {
  it('places each anchor on its storey in world coordinates', () => {
    const anchors = compileAnchors(BANK_1, { x: 100, z: 20 });
    const lift2 = anchors.find((a) => a.id === 'bank-1:lift:2');
    expect(lift2).toMatchObject({
      kind: 'elevator',
      x: 109.5,
      z: 25,
      y: 6,
      storey: 2,
      bank: 'bank-1',
    });
  });

  it('is usable only on its own floor and within reach', () => {
    const lift = HEIST_MAP.anchors?.find((a) => a.id === 'bank-1:lift:0');
    expect(lift && anchorInReach(lift, 9.5, 0, 5)).toBe(true);
    expect(lift && anchorInReach(lift, 9.5, 3, 5)).toBe(false); // the floor above
    expect(lift && anchorInReach(lift, 12, 0, 5)).toBe(false); // 2.5 m away
    expect(nearestAnchor(HEIST_MAP, 9, 0, 5)?.id).toBe('bank-1:lift:0');
    expect(nearestAnchor(HEIST_MAP, -20, 0, -20)).toBeUndefined();
  });

  it('keeps every lift pad clear of walls and blocks', () => {
    const boxes = compileBank(BANK_1, { x: 0, z: 0 });
    for (const a of compileAnchors(BANK_1, { x: 0, z: 0 })) {
      const inside = boxes.some(
        (b) =>
          a.x > b.minX &&
          a.x < b.maxX &&
          a.z > b.minZ &&
          a.z < b.maxZ &&
          a.y + 1 > b.minY &&
          a.y + 1 < b.maxY,
      );
      expect(inside, a.id).toBe(false);
    }
  });

  it('rejects duplicate or misplaced anchors', () => {
    const lift = { id: 'a', kind: 'elevator' as const, storey: 0, x: 0, z: 0 };
    expect(() => validateBank({ ...tiny, anchors: [lift, lift] })).toThrow(/duplicate/);
    expect(() => validateBank({ ...tiny, anchors: [{ ...lift, storey: 3 }] })).toThrow(
      /missing storey/,
    );
    expect(() => validateBank({ ...tiny, anchors: [{ ...lift, x: 9 }] })).toThrow(
      /leaves the footprint/,
    );
  });
});

describe('vault', () => {
  const vault = HEIST_MAP.vaults?.[0];
  const door = HEIST_MAP.doors?.[0];

  it('is described on the map with its door, console and loot spots', () => {
    expect(vault).toMatchObject({
      id: 'bank-1:vault',
      bank: 'bank-1',
      tier: 1,
      doorId: 'bank-1:vault:door',
      consoleId: 'bank-1:vault:console',
    });
    expect(vault?.loot).toHaveLength(5);
    expect(HEIST_MAP.anchors?.find((a) => a.id === vault?.consoleId)).toMatchObject({
      kind: 'vault_console',
      y: 6,
    });
  });

  it('keeps the door out of the fixed boxes', () => {
    expect(door && HEIST_MAP.boxes.includes(door.box)).toBe(false);
  });

  /** Walks east through the vault doorway on the top storey. */
  const walkIn = (map: typeof HEIST_MAP) => {
    const body = createBody(2.4, 6, -5.3);
    for (let i = 0; i < 120; i++)
      stepBody(body, forward(i, -Math.PI / 2), SIM_DT, map, DEFAULT_MOVEMENT_SETTINGS);
    return body;
  };

  it('blocks the doorway while closed and lets players in once open', () => {
    expect(walkIn(mapWithClosedDoors(HEIST_MAP, ['bank-1:vault:door'])).x).toBeLessThan(3.8);
    expect(walkIn(mapWithClosedDoors(HEIST_MAP, [])).x).toBeGreaterThan(6);
  });

  it('puts every loot spot inside the vault room, clear of walls', () => {
    const boxes = [...HEIST_MAP.boxes];
    for (const spot of vault?.loot ?? []) {
      expect(spot.x).toBeGreaterThan(4.5);
      expect(spot.z).toBeLessThan(-1.5);
      expect(
        boxes.some(
          (b) =>
            spot.x > b.minX &&
            spot.x < b.maxX &&
            spot.z > b.minZ &&
            spot.z < b.maxZ &&
            spot.y + 0.5 > b.minY &&
            spot.y + 0.5 < b.maxY,
        ),
      ).toBe(false);
    }
  });

  it('rejects a vault without loot', () => {
    const spec = {
      id: 'v',
      storey: 0,
      door: { x: 0, z: 0, width: 1, depth: 1, height: 2 },
      console: { x: 0, z: 0 },
      loot: [],
    };
    expect(() => validateBank({ ...tiny, vaults: [spec] })).toThrow(/no loot/);
  });
});

describe('mapWithClosedDoors', () => {
  it('returns the same cached map for the same set of closed doors', () => {
    const a = mapWithClosedDoors(HEIST_MAP, ['bank-1:vault:door']);
    expect(mapWithClosedDoors(HEIST_MAP, ['bank-1:vault:door'])).toBe(a);
    expect(a.boxes).toHaveLength(HEIST_MAP.boxes.length + 1);
  });
  it('is the base map when everything is open', () => {
    expect(mapWithClosedDoors(HEIST_MAP, [])).toBe(HEIST_MAP);
  });
  it('ignores unknown door ids', () => {
    expect(mapWithClosedDoors(HEIST_MAP, ['nope'])).toBe(HEIST_MAP);
  });
});
