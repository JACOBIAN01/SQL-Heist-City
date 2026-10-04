import { describe, expect, it } from 'vitest';
import { DEFAULT_MOVEMENT_SETTINGS as cfg } from '../config/movement';
import { box, type GameMap } from '../world/map';
import { TEST_MAP } from '../world/testMap';
import { Button, SIM_DT, type InputCommand } from './input';
import { createBody, idleCommand, stepBody, type BodyState } from './movement';

const flat: GameMap = { id: 't', halfSize: 50, boxes: [], spawns: [] };
const cmd = (over: Partial<InputCommand> = {}): InputCommand => ({ ...idleCommand(0), ...over });
const run = (body: BodyState, c: InputCommand, ticks: number, map: GameMap = flat) => {
  for (let i = 0; i < ticks; i++) stepBody(body, c, SIM_DT, map, cfg);
};
const forward = (over: Partial<InputCommand> = {}) => cmd({ moveY: 127, ...over });

describe('stepBody: walking', () => {
  it('stays put with no input', () => {
    const b = createBody(1, 0, 2);
    run(b, cmd(), 60);
    expect([b.x, b.y, b.z]).toEqual([1, 0, 2]);
  });

  it('walks forward (−z at yaw 0) at walk speed', () => {
    const b = createBody(0, 0, 0);
    run(b, forward(), 120);
    expect(b.x).toBeCloseTo(0, 5);
    expect(-b.z).toBeCloseTo(cfg.walkSpeed * 2, 0);
  });

  it('scales top speed by speedScale', () => {
    const slow = createBody(0, 0, 0);
    for (let i = 0; i < 120; i++) stepBody(slow, forward(), SIM_DT, flat, cfg, 0.5);
    expect(-slow.z).toBeCloseTo(cfg.walkSpeed * 2 * 0.5, 0);
  });

  it('follows yaw: facing left (+π/2) walks toward −x', () => {
    const b = createBody(0, 0, 0);
    run(b, forward({ yaw: Math.PI / 2 }), 60);
    expect(b.x).toBeLessThan(-3);
    expect(Math.abs(b.z)).toBeLessThan(0.01);
  });

  it('strafes right (+x at yaw 0)', () => {
    const b = createBody(0, 0, 0);
    run(b, cmd({ moveX: 127 }), 60);
    expect(b.x).toBeGreaterThan(3);
  });

  it('does not go faster diagonally', () => {
    const straight = createBody(0, 0, 0);
    const diagonal = createBody(0, 0, 0);
    run(straight, forward(), 90);
    run(diagonal, forward({ moveX: 127 }), 90);
    expect(Math.hypot(diagonal.x, diagonal.z)).toBeCloseTo(Math.hypot(straight.x, straight.z), 1);
  });

  it('sprints faster than it walks, and crouching is slowest', () => {
    const walk = createBody(0, 0, 0);
    const sprint = createBody(0, 0, 0);
    const crouch = createBody(0, 0, 0);
    run(walk, forward(), 90);
    run(sprint, forward({ buttons: Button.Sprint }), 90);
    run(crouch, forward({ buttons: Button.Crouch }), 90);
    expect(-sprint.z).toBeGreaterThan(-walk.z);
    expect(-crouch.z).toBeLessThan(-walk.z);
  });

  it('is deterministic: same inputs give identical state', () => {
    const a = createBody(0, 0, 0);
    const b = createBody(0, 0, 0);
    const script = [forward(), forward({ buttons: Button.Jump, yaw: 1 }), cmd({ moveX: -127 })];
    for (let i = 0; i < 200; i++) {
      stepBody(a, script[i % 3] as InputCommand, SIM_DT, TEST_MAP, cfg);
      stepBody(b, script[i % 3] as InputCommand, SIM_DT, TEST_MAP, cfg);
    }
    expect(a).toEqual(b);
  });
});

describe('stepBody: jumping and gravity', () => {
  it('jumps about v²/2g high and lands again', () => {
    const b = createBody(0, 0, 0);
    let peak = 0;
    stepBody(b, cmd({ buttons: Button.Jump }), SIM_DT, flat, cfg);
    for (let i = 0; i < 120; i++) {
      stepBody(b, cmd(), SIM_DT, flat, cfg);
      peak = Math.max(peak, b.y);
    }
    expect(peak).toBeCloseTo(cfg.jumpSpeed ** 2 / (2 * cfg.gravity), 0);
    expect(b.y).toBe(0);
    expect(b.onGround).toBe(true);
  });

  it('cannot double-jump', () => {
    const b = createBody(0, 0, 0);
    run(b, cmd({ buttons: Button.Jump }), 40);
    // Holding jump while airborne must not re-launch; after landing it jumps again.
    const midAir = createBody(0, 0, 0);
    stepBody(midAir, cmd({ buttons: Button.Jump }), SIM_DT, flat, cfg);
    const vy1 = midAir.vy;
    stepBody(midAir, cmd({ buttons: Button.Jump }), SIM_DT, flat, cfg);
    expect(midAir.vy).toBeLessThan(vy1);
  });

  it('falls onto a crate and stands on it', () => {
    const map: GameMap = { ...flat, boxes: [box('crate', 0, 0, 2, 1, 2)] };
    const b = createBody(0, 3, 0);
    b.onGround = false;
    run(b, cmd(), 60, map);
    expect(b.y).toBeCloseTo(1, 3);
    expect(b.onGround).toBe(true);
  });

  it('bumps its head on a low ceiling', () => {
    const map: GameMap = { ...flat, boxes: [box('wall', 0, 0, 4, 1, 4, 2.2)] };
    const b = createBody(0, 0, 0);
    stepBody(b, cmd({ buttons: Button.Jump }), SIM_DT, map, cfg);
    run(b, cmd(), 30, map);
    expect(b.y + cfg.standHeight).toBeLessThanOrEqual(2.2 + 1e-3);
  });
});

describe('stepBody: collisions', () => {
  const wall: GameMap = { ...flat, boxes: [box('wall', 0, -5, 10, 3, 1)] };

  it('is stopped by a wall and never ends up inside it', () => {
    const b = createBody(0, 0, 0);
    run(b, forward(), 240, wall);
    expect(b.z).toBeGreaterThanOrEqual(-4.5 + cfg.radius - 1e-3);
    expect(b.z).toBeLessThan(-4.5 + cfg.radius + 0.01);
  });

  it('slides along a wall when pushing diagonally', () => {
    const b = createBody(0, 0, 0);
    run(b, forward({ moveX: 127 }), 240, wall);
    expect(b.x).toBeGreaterThan(3);
  });

  it('walks up steps lower than the step height but not a full wall', () => {
    const kerb: GameMap = { ...flat, boxes: [box('step', 0, -10, 6, 0.25, 12)] };
    const b = createBody(0, 0, 0);
    run(b, forward(), 120, kerb);
    expect(b.y).toBeCloseTo(0.25, 2);
    const high: GameMap = { ...flat, boxes: [box('step', 0, -3, 6, 1, 2)] };
    const c = createBody(0, 0, 0);
    run(c, forward(), 120, high);
    expect(c.y).toBe(0);
    expect(c.z).toBeGreaterThan(-2.2);
  });

  it('climbs the sandbox staircase to the platform', () => {
    const b = createBody(24, 0, 4.5);
    run(b, forward({ yaw: Math.PI }), 150, TEST_MAP);
    expect(b.y).toBeCloseTo(2, 1);
  });

  it('stays inside the map bounds', () => {
    const b = createBody(0, 0, 0);
    run(b, forward({ yaw: -Math.PI / 2 }), 2000);
    expect(b.x).toBeLessThanOrEqual(flat.halfSize);
  });
});

describe('stepBody: crouching', () => {
  it('crouches and stands up when there is room', () => {
    const b = createBody(0, 0, 0);
    stepBody(b, cmd({ buttons: Button.Crouch }), SIM_DT, flat, cfg);
    expect(b.crouching).toBe(true);
    stepBody(b, cmd(), SIM_DT, flat, cfg);
    expect(b.crouching).toBe(false);
  });

  it('stays crouched under a low ceiling', () => {
    const map: GameMap = { ...flat, boxes: [box('wall', 0, 0, 4, 1, 4, 1.4)] };
    const b = createBody(0, 0, 0);
    stepBody(b, cmd({ buttons: Button.Crouch }), SIM_DT, map, cfg);
    stepBody(b, cmd(), SIM_DT, map, cfg);
    expect(b.crouching).toBe(true);
  });
});
