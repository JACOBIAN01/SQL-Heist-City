import { describe, expect, it } from 'vitest';
import { box, type GameMap } from './map';
import { rayAabb, raycastMap } from './raycast';

const b = box('wall', 0, -10, 4, 4, 2); // x −2..2, y 0..4, z −11..−9
const map: GameMap = { id: 't', halfSize: 50, boxes: [b], spawns: [] };

describe('rayAabb', () => {
  it('hits the near face', () => {
    expect(rayAabb(0, 1, 0, 0, 0, -1, b, 100)).toBeCloseTo(9);
  });

  it('misses to the side, behind, and beyond max distance', () => {
    expect(rayAabb(5, 1, 0, 0, 0, -1, b, 100)).toBeUndefined();
    expect(rayAabb(0, 1, 0, 0, 0, 1, b, 100)).toBeUndefined();
    expect(rayAabb(0, 1, 0, 0, 0, -1, b, 5)).toBeUndefined();
  });

  it('handles rays parallel to a slab', () => {
    expect(rayAabb(0, 10, 0, 0, 0, -1, b, 100)).toBeUndefined();
    expect(rayAabb(0, 2, 0, 0, 0, -1, b, 100)).toBeCloseTo(9);
  });

  it('reports 0 from inside the box', () => {
    expect(rayAabb(0, 1, -10, 0, 0, -1, b, 100)).toBe(0);
  });
});

describe('raycastMap', () => {
  it('returns the nearest box', () => {
    expect(raycastMap(map, 0, 1, 0, 0, 0, -1, 50)).toBeCloseTo(9);
  });

  it('hits the ground when looking down', () => {
    const t = raycastMap(map, 20, 2, 0, 0, -1, 0, 50);
    expect(t).toBeCloseTo(2);
  });

  it('returns undefined when nothing is in range', () => {
    expect(raycastMap(map, 0, 1, 0, 0, 0, 1, 50)).toBeUndefined();
  });
});
