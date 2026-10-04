import { colliderGridFor } from './ColliderGrid';
import type { GameMap } from './map';
import { rayAabb } from './rayAabb';

export { rayAabb };

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
  let best = colliderGridFor(map).raycast(ox, oy, oz, dx, dy, dz, maxDist);
  if (dy < 0 && oy > 0) {
    const t = -oy / dy;
    if (t <= maxDist && (best === undefined || t < best)) best = t;
  }
  return best;
}
