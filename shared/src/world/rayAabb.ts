import type { Aabb } from './map';

/**
 * Distance along a ray (unit direction) to the first face of a box, or
 * undefined when it misses or is further than `maxDist`. Slab method, written
 * out per axis (no temporary arrays) because shots and movement call it a lot.
 */
export function rayAabb(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  box: Aabb,
  maxDist: number,
): number | undefined {
  let tMin = 0;
  let tMax = maxDist;

  if (Math.abs(dx) < 1e-12) {
    if (ox < box.minX || ox > box.maxX) return undefined;
  } else {
    let t1 = (box.minX - ox) / dx;
    let t2 = (box.maxX - ox) / dx;
    if (t1 > t2) {
      const t = t1;
      t1 = t2;
      t2 = t;
    }
    if (t1 > tMin) tMin = t1;
    if (t2 < tMax) tMax = t2;
    if (tMin > tMax) return undefined;
  }

  if (Math.abs(dy) < 1e-12) {
    if (oy < box.minY || oy > box.maxY) return undefined;
  } else {
    let t1 = (box.minY - oy) / dy;
    let t2 = (box.maxY - oy) / dy;
    if (t1 > t2) {
      const t = t1;
      t1 = t2;
      t2 = t;
    }
    if (t1 > tMin) tMin = t1;
    if (t2 < tMax) tMax = t2;
    if (tMin > tMax) return undefined;
  }

  if (Math.abs(dz) < 1e-12) {
    if (oz < box.minZ || oz > box.maxZ) return undefined;
  } else {
    let t1 = (box.minZ - oz) / dz;
    let t2 = (box.maxZ - oz) / dz;
    if (t1 > t2) {
      const t = t1;
      t1 = t2;
      t2 = t;
    }
    if (t1 > tMin) tMin = t1;
    if (t2 < tMax) tMax = t2;
    if (tMin > tMax) return undefined;
  }
  return tMin;
}
