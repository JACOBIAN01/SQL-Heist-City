import { describe, expect, it } from 'vitest';
import { DEFAULT_MOVEMENT_SETTINGS } from '../../config/movement';
import { SIM_DT } from '../../sim/input';
import { createBody, stepBody } from '../../sim/movement';
import { HEIST_MAP } from '../heistMap';
import type { BankLayout } from './BankLayout';
import { BANK_1 } from './bank1';
import { compileBank, validateBank } from './compileBank';

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
