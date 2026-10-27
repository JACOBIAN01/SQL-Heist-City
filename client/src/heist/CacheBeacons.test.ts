import { Scene } from 'three';
import { describe, expect, it } from 'vitest';
import { CacheBeacons } from './CacheBeacons';

describe('CacheBeacons', () => {
  it('shows what the server sends and drops what it stops sending', () => {
    const scene = new Scene();
    const c = new CacheBeacons(scene);
    c.apply([
      { id: 1, x: 10, z: 20 },
      { id: 2, x: -5, z: 8 },
    ]);
    expect(c.count).toBe(2);
    expect(scene.children).toHaveLength(2);
    c.apply([{ id: 2, x: -5, z: 8 }]);
    expect(c.count).toBe(1);
    expect(scene.children).toHaveLength(1);
    expect([...c.positions()]).toEqual([{ id: 2, x: -5, z: 8 }]);
  });

  it('does not rebuild a cache it already shows', () => {
    const scene = new Scene();
    const c = new CacheBeacons(scene);
    c.apply([{ id: 1, x: 0, z: 0 }]);
    const first = scene.children[0];
    c.apply([{ id: 1, x: 0, z: 0 }]);
    expect(scene.children[0]).toBe(first);
  });
});
