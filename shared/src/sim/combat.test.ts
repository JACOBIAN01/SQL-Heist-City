import { describe, expect, it } from 'vitest';
import { DEFAULT_COMBAT_SETTINGS as combat } from '../config/combat';
import { DEFAULT_MOVEMENT_SETTINGS as move } from '../config/movement';
import { box, type GameMap } from '../world/map';
import { aimDirection, aimOrigin, rayCylinder, resolveShot, type ShotTarget } from './combat';

const open: GameMap = { id: 'o', halfSize: 100, boxes: [], spawns: [] };
const target = (id: number, x: number, z: number, height = 1.8): ShotTarget => ({
  id,
  x,
  y: 0,
  z,
  height,
});
const origin = { x: 0, y: 1.5, z: 0 };
const forward = { x: 0, y: 0, z: -1 };

describe('aim helpers', () => {
  it('faces −z at yaw 0 and looks up with positive pitch', () => {
    expect(aimDirection(0, 0)).toEqual({ x: -0, y: 0, z: -1 });
    expect(aimDirection(0, Math.PI / 4).y).toBeGreaterThan(0.7);
    expect(aimDirection(Math.PI / 2, 0).x).toBeCloseTo(-1);
  });

  it('starts shots at the shoulder-offset eye, lower when crouching', () => {
    const stand = aimOrigin({ x: 1, y: 0, z: 2, crouching: false }, 0, move);
    expect(stand).toEqual({ x: 1 + move.shoulder, y: move.eyeHeight, z: 2 });
    expect(aimOrigin({ x: 1, y: 0, z: 2, crouching: true }, 0, move).y).toBe(move.crouchEyeHeight);
  });
});

describe('rayCylinder', () => {
  const o = { x: 0, y: 1, z: 0 };
  it('hits the side', () => {
    expect(rayCylinder(o, forward, 0, -10, 0.4, 0, 1.8, 50)).toBeCloseTo(9.6);
  });
  it('misses wide, high and short', () => {
    expect(rayCylinder(o, forward, 1, -10, 0.4, 0, 1.8, 50)).toBeUndefined();
    expect(rayCylinder({ ...o, y: 3 }, forward, 0, -10, 0.4, 0, 1.8, 50)).toBeUndefined();
    expect(rayCylinder(o, forward, 0, -10, 0.4, 0, 1.8, 5)).toBeUndefined();
  });
  it('hits the top cap from above', () => {
    const t = rayCylinder({ x: 0, y: 5, z: 0 }, { x: 0, y: -1, z: 0 }, 0, 0, 0.4, 0, 1.8, 50);
    expect(t).toBeCloseTo(3.2);
  });
  it('is zero from inside', () => {
    expect(rayCylinder({ x: 0, y: 1, z: 0 }, forward, 0, 0, 0.4, 0, 1.8, 50)).toBe(0);
  });
});

describe('resolveShot', () => {
  it('hits the body, and the head when high', () => {
    expect(resolveShot(open, origin, forward, 80, [target(2, 0, -10)], combat)).toMatchObject({
      hit: 'body',
      target: 2,
    });
    const head = resolveShot(open, { ...origin, y: 1.7 }, forward, 80, [target(2, 0, -10)], combat);
    expect(head).toMatchObject({ hit: 'head', target: 2 });
  });

  it('picks the nearest target', () => {
    const r = resolveShot(
      open,
      origin,
      forward,
      80,
      [target(3, 0, -20), target(2, 0, -10)],
      combat,
    );
    expect(r.target).toBe(2);
  });

  it('is blocked by walls', () => {
    const wall: GameMap = { ...open, boxes: [box('wall', 0, -5, 10, 4, 0.5)] };
    const r = resolveShot(wall, origin, forward, 80, [target(2, 0, -10)], combat);
    expect(r.hit).toBe('miss');
    expect(r.distance).toBeCloseTo(4.75);
  });

  it('respects weapon range and reports where a miss ended', () => {
    const r = resolveShot(open, origin, forward, 8, [target(2, 0, -10)], combat);
    expect(r).toMatchObject({ hit: 'miss', target: 0 });
    expect(r.end.z).toBeCloseTo(-8);
  });

  it('a crouching target is shorter: a high shot passes over', () => {
    const r = resolveShot(
      open,
      { ...origin, y: 1.5 },
      forward,
      80,
      [target(2, 0, -10, 1.1)],
      combat,
    );
    expect(r.hit).toBe('miss');
  });
});
