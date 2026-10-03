import { describe, expect, it } from 'vitest';
import { Scene, type LineSegments } from 'three';
import { DEFAULT_COMBAT_SETTINGS, DEFAULT_MOVEMENT_SETTINGS, Flag } from '@heist/shared';
import { HitboxDebug } from './HitboxDebug';

const make = () => {
  const scene = new Scene();
  return {
    scene,
    debug: new HitboxDebug(scene, DEFAULT_COMBAT_SETTINGS, DEFAULT_MOVEMENT_SETTINGS),
  };
};
const pose = (id: number, flags: number = Flag.Alive) => ({ id, x: 1, y: 0, z: 2, flags, hp: 100 });

describe('HitboxDebug', () => {
  it('adds one outline per player and removes it when they go', () => {
    const { scene, debug } = make();
    debug.update([pose(1), pose(2)]);
    expect(debug.count).toBe(2);
    expect(scene.children).toHaveLength(2);
    debug.update([pose(2)]);
    expect(scene.children).toHaveLength(1);
  });

  it('is as tall as the server hit-box: standing, crouching, with a head slice on top', () => {
    const { scene, debug } = make();
    debug.update([pose(1)]);
    const [body, head] = scene.children[0]?.children as LineSegments[];
    expect(body?.scale.y).toBeCloseTo(
      DEFAULT_MOVEMENT_SETTINGS.standHeight - DEFAULT_COMBAT_SETTINGS.headHeight,
    );
    expect(head?.scale.y).toBeCloseTo(DEFAULT_COMBAT_SETTINGS.headHeight);
    expect(body?.scale.x).toBe(DEFAULT_COMBAT_SETTINGS.bodyRadius);
    debug.update([pose(1, Flag.Alive | Flag.Crouching)]);
    expect((body?.scale.y ?? 0) + (head?.scale.y ?? 0)).toBeCloseTo(
      DEFAULT_MOVEMENT_SETTINGS.crouchHeight,
    );
  });

  it('hides the box of a dead player', () => {
    const { scene, debug } = make();
    debug.update([pose(1, 0)]);
    expect(scene.children[0]?.visible).toBe(false);
  });
});
