import { describe, expect, it } from 'vitest';
import { PerspectiveCamera } from 'three';
import { box, type GameMap } from '@heist/shared';
import { CameraRig } from './CameraRig';

const open: GameMap = { id: 'o', halfSize: 50, boxes: [], spawns: [] };

describe('CameraRig', () => {
  it('sits behind the player along the view direction', () => {
    const camera = new PerspectiveCamera();
    new CameraRig(camera, open, { distance: 4, shoulder: 0 }).update(0, 0, 0, 0, 0, 1);
    // Facing −z, so the camera is at +z behind the player, at head height.
    expect(camera.position.z).toBeCloseTo(4);
    expect(camera.position.x).toBeCloseTo(0);
    expect(camera.position.y).toBeCloseTo(1.55);
  });

  it('offsets to the right shoulder', () => {
    const camera = new PerspectiveCamera();
    new CameraRig(camera, open, { shoulder: 0.5 }).update(0, 0, 0, 0, 0, 1);
    expect(camera.position.x).toBeCloseTo(0.5);
  });

  it('moves in front of a wall instead of clipping through it', () => {
    const wall: GameMap = { ...open, boxes: [box('wall', 0, 2, 10, 4, 0.5)] }; // z 1.75..2.25
    const camera = new PerspectiveCamera();
    new CameraRig(camera, wall, { distance: 4, shoulder: 0 }).update(0, 0, 0, 0, 0, 1);
    expect(camera.position.z).toBeLessThan(1.75);
    expect(camera.position.z).toBeGreaterThan(0);
  });

  it('never goes below the ground when looking steeply up', () => {
    const camera = new PerspectiveCamera();
    new CameraRig(camera, open).update(0, 0, 0, 0, 1.4, 1);
    expect(camera.position.y).toBeGreaterThanOrEqual(0.15);
  });

  it('eases back out after a wall is gone instead of popping', () => {
    const wall: GameMap = { ...open, boxes: [box('wall', 0, 2, 10, 4, 0.5)] };
    const camera = new PerspectiveCamera();
    const rig = new CameraRig(camera, wall, { distance: 4, shoulder: 0 });
    rig.update(0, 0, 0, 0, 0, 1);
    const pulledIn = camera.position.z;
    rig.update(0, 0, 0, Math.PI, 0, 0.1); // turned away: clear view behind
    const distance = Math.abs(camera.position.z);
    expect(distance).toBeGreaterThan(pulledIn);
    expect(distance).toBeLessThan(4);
    rig.update(0, 0, 0, Math.PI, 0, 5);
    expect(Math.abs(camera.position.z)).toBeCloseTo(4);
  });
});
