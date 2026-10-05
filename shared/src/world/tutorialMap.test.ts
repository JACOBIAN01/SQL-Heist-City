import { describe, expect, it } from 'vitest';
import { TUTORIAL_STEP_IDS, TUTORIAL_STEPS } from '../config/tutorial';
import { DEFAULT_MOVEMENT_SETTINGS } from '../config/movement';
import { SIM_DT } from '../sim/input';
import { createBody, stepBody, type BodyState } from '../sim/movement';
import type { Aabb, GameMap } from './map';
import { mapById } from './maps';
import { TUTORIAL_MAP, TUTORIAL_TARGETS } from './tutorialMap';
import { mapWithClosedDoors } from './variant';

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
function route(map: GameMap, points: readonly (readonly [number, number])[], body: BodyState) {
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

const overlaps = (a: Aabb, b: Aabb) =>
  a.minX < b.maxX &&
  a.maxX > b.minX &&
  a.minY < b.maxY &&
  a.maxY > b.minY &&
  a.minZ < b.maxZ &&
  a.maxZ > b.minZ;

const near = (body: BodyState, x: number, z: number) => Math.hypot(body.x - x, body.z - z);

describe('tutorial steps', () => {
  it('has words for every step, in order', () => {
    expect(TUTORIAL_STEPS.map((s) => s.id)).toEqual([...TUTORIAL_STEP_IDS]);
  });
});

describe('TUTORIAL_MAP', () => {
  const closed = mapWithClosedDoors(
    TUTORIAL_MAP,
    (TUTORIAL_MAP.doors ?? []).map((d) => d.id),
  );
  const start = () => {
    const s = TUTORIAL_MAP.spawns[0];
    if (!s) throw new Error('no spawn');
    return createBody(s.x, 0, s.z);
  };

  it('is loaded by id like any other map', () => {
    expect(mapById('tutorial')).toBe(TUTORIAL_MAP);
  });

  it('keeps the start and the targets inside the walls and clear of every box', () => {
    for (const s of [...TUTORIAL_MAP.spawns, ...(TUTORIAL_MAP.dummies ?? [])]) {
      const body = {
        minX: s.x - 0.5,
        maxX: s.x + 0.5,
        minZ: s.z - 0.5,
        maxZ: s.z + 0.5,
        minY: 0,
        maxY: 2,
      };
      expect(Math.abs(s.x)).toBeLessThan(TUTORIAL_MAP.halfSize);
      expect(TUTORIAL_MAP.boxes.some((b) => overlaps(b, body))).toBe(false);
    }
  });

  it('has a bank with one vault and a safehouse', () => {
    expect(TUTORIAL_MAP.vaults).toHaveLength(1);
    expect(TUTORIAL_MAP.anchors?.filter((a) => a.kind === 'safehouse')).toHaveLength(1);
  });

  it('walks from the start to the marker, and on to the range', () => {
    const { move, shoot } = TUTORIAL_TARGETS;
    if (!move || !shoot) throw new Error('missing targets');
    const body = route(closed, [[move.x, move.z]], start());
    expect(near(body, move.x, move.z)).toBeLessThan(0.5);
    route(closed, [[shoot.x, shoot.z]], body);
    expect(near(body, shoot.x, shoot.z)).toBeLessThan(0.5);
  });

  it('climbs the bank to the vault console', () => {
    const console_ = TUTORIAL_TARGETS.vault;
    if (!console_) throw new Error('no console');
    // Bank 1's stairs (see compileBank.test), 8 m north as the tutorial places it.
    const body = route(
      closed,
      [
        [0, -2],
        [-10, -2],
        [-10, -9],
        [-10, -16],
        [-8.9, -16.3],
        [-7.5, -16.3],
        [-7.5, -11],
        [console_.x, -11],
        [console_.x, console_.z],
      ],
      start(),
    );
    expect(body.y).toBeCloseTo(console_.y, 1);
    expect(near(body, console_.x, console_.z)).toBeLessThan(0.5);
  });

  it('reaches the first bag once the vault door is open', () => {
    const bag = TUTORIAL_TARGETS.loot;
    const console_ = TUTORIAL_TARGETS.vault;
    if (!bag || !console_) throw new Error('missing targets');
    const body = createBody(console_.x, console_.y, console_.z);
    route(TUTORIAL_MAP, [[bag.x, bag.z]], body);
    expect(near(body, bag.x, bag.z)).toBeLessThan(0.5);
    expect(body.y).toBeCloseTo(bag.y, 1);
  });
});
