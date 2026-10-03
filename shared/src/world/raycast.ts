import type { Aabb, GameMap } from './map';

/**
 * Distance along a ray (unit direction) to the first face of a box, or
 * undefined when it misses or is further than `maxDist`. Slab method.
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
  const slabs: [number, number, number, number][] = [
    [ox, dx, box.minX, box.maxX],
    [oy, dy, box.minY, box.maxY],
    [oz, dz, box.minZ, box.maxZ],
  ];
  for (const [o, d, lo, hi] of slabs) {
    if (Math.abs(d) < 1e-12) {
      if (o < lo || o > hi) return undefined;
      continue;
    }
    let t1 = (lo - o) / d;
    let t2 = (hi - o) / d;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return undefined;
  }
  return tMin;
}

/** Nearest world hit (any box, or the ground plane) along a unit-direction ray, up to `maxDist`. */
export function raycastMap(
  map: GameMap,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  maxDist: number,
): number | undefined {
  let best: number | undefined;
  for (const box of map.boxes) {
    const t = rayAabb(ox, oy, oz, dx, dy, dz, box, maxDist);
    if (t !== undefined && (best === undefined || t < best)) best = t;
  }
  if (dy < 0 && oy > 0) {
    const t = -oy / dy;
    if (t <= maxDist && (best === undefined || t < best)) best = t;
  }
  return best;
}
