import { describe, expect, it } from 'vitest';
import { Scene } from 'three';
import { Tracers } from './Tracers';

const p = (x: number) => ({ x, y: 0, z: 0 });

describe('Tracers', () => {
  it('shows a trail then hides it after its lifetime', () => {
    const tracers = new Tracers(new Scene(), 4, 0.1);
    tracers.add(p(0), p(5));
    expect(tracers.activeCount).toBe(1);
    tracers.update(0.05);
    expect(tracers.activeCount).toBe(1);
    tracers.update(0.06);
    expect(tracers.activeCount).toBe(0);
  });

  it('adds a fixed number of objects to the scene and never more', () => {
    const scene = new Scene();
    const tracers = new Tracers(scene, 3);
    for (let i = 0; i < 20; i++) tracers.add(p(0), p(i));
    expect(scene.children).toHaveLength(3);
    expect(tracers.activeCount).toBe(3);
  });

  it('writes the endpoints into the line', () => {
    const scene = new Scene();
    const tracers = new Tracers(scene, 1);
    tracers.add({ x: 1, y: 2, z: 3 }, { x: 4, y: 5, z: 6 });
    const line = scene.children[0] as unknown as {
      geometry: { getAttribute(n: string): { array: Float32Array } };
    };
    expect([...line.geometry.getAttribute('position').array]).toEqual([1, 2, 3, 4, 5, 6]);
  });
});
