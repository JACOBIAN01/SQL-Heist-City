import { describe, expect, it } from 'vitest';
import { AimView } from './AimView';

describe('AimView', () => {
  it('eases the view in to the gun’s zoom and back out', () => {
    const view = new AimView(70);
    expect(view.fov).toBe(70);
    for (let i = 0; i < 6; i++) view.update(4, 1 / 60);
    expect(view.fov).toBeLessThan(70);
    expect(view.fov).toBeGreaterThan(70 / 4); // still on its way
    for (let i = 0; i < 120; i++) view.update(4, 1 / 60);
    expect(view.fov).toBeCloseTo(17.5);
    for (let i = 0; i < 120; i++) view.update(1, 1 / 60);
    expect(view.fov).toBe(70);
  });

  it('slows mouse look as it zooms, and is a scope only far in', () => {
    const view = new AimView(70);
    for (let i = 0; i < 120; i++) view.update(1.6, 1 / 60);
    expect(view.lookScale).toBeCloseTo(1 / 1.6);
    expect(view.scoped).toBe(false);
    for (let i = 0; i < 120; i++) view.update(4, 1 / 60);
    expect(view.scoped).toBe(true);
  });
});
