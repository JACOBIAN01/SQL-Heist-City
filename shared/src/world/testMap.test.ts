import { describe, expect, it } from 'vitest';
import { TEST_MAP } from './testMap';
import type { Aabb } from './map';

const overlaps = (a: Aabb, b: Aabb) =>
  a.minX < b.maxX &&
  a.maxX > b.minX &&
  a.minY < b.maxY &&
  a.maxY > b.minY &&
  a.minZ < b.maxZ &&
  a.maxZ > b.minZ;

describe('TEST_MAP', () => {
  it('has well-formed boxes', () => {
    for (const b of TEST_MAP.boxes) {
      expect(b.minX).toBeLessThan(b.maxX);
      expect(b.minY).toBeLessThan(b.maxY);
      expect(b.minZ).toBeLessThan(b.maxZ);
    }
  });

  it('has spawn points inside the walls and clear of every box', () => {
    expect(TEST_MAP.spawns.length).toBeGreaterThanOrEqual(8);
    for (const s of TEST_MAP.spawns) {
      expect(Math.abs(s.x)).toBeLessThan(TEST_MAP.halfSize);
      expect(Math.abs(s.z)).toBeLessThan(TEST_MAP.halfSize);
      const body = {
        minX: s.x - 0.5,
        maxX: s.x + 0.5,
        minZ: s.z - 0.5,
        maxZ: s.z + 0.5,
        minY: 0,
        maxY: 2,
      };
      expect(TEST_MAP.boxes.some((b) => overlaps(b, body))).toBe(false);
    }
  });
});
