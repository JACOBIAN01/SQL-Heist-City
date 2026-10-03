import { describe, expect, it } from 'vitest';
import { DEFAULT_MOVEMENT_SETTINGS, TEST_MAP, idleCommand } from '@heist/shared';
import { LocalPlayer } from './LocalPlayer';

const spawn = { x: 0, z: 0, yaw: 0 };

describe('LocalPlayer', () => {
  it('moves under the shared simulation', () => {
    const p = new LocalPlayer(TEST_MAP, DEFAULT_MOVEMENT_SETTINGS, spawn);
    for (let i = 0; i < 60; i++) p.apply({ ...idleCommand(i), moveY: 127 });
    expect(p.body.z).toBeLessThan(-3);
  });

  it('blends the drawn position between the last two ticks', () => {
    const p = new LocalPlayer(TEST_MAP, DEFAULT_MOVEMENT_SETTINGS, spawn);
    for (let i = 0; i < 30; i++) p.apply({ ...idleCommand(i), moveY: 127 });
    const out = { x: 0, y: 0, z: 0 };
    p.drawPosition(1, out);
    expect(out.z).toBeCloseTo(p.body.z);
    p.drawPosition(0, out);
    expect(out.z).toBeGreaterThan(p.body.z);
  });

  it('teleports and stops dead', () => {
    const p = new LocalPlayer(TEST_MAP, DEFAULT_MOVEMENT_SETTINGS, spawn);
    for (let i = 0; i < 30; i++) p.apply({ ...idleCommand(i), moveY: 127 });
    p.teleport(5, 0, 5);
    expect([p.body.x, p.body.vz]).toEqual([5, 0]);
  });
});
