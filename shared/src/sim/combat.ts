import type { MovementSettings } from '../config/movement';
import type { CombatSettings } from '../config/combat';
import type { HitKind } from '../net/gameMessages';
import type { GameMap } from '../world/map';
import { raycastMap } from '../world/raycast';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Where a shot starts: the camera pivot (eye height plus the shoulder offset), so it passes through the crosshair. */
export function aimOrigin(
  body: { x: number; y: number; z: number; crouching: boolean },
  yaw: number,
  cfg: MovementSettings,
): Vec3 {
  const eye = body.crouching ? cfg.crouchEyeHeight : cfg.eyeHeight;
  return {
    x: body.x + Math.cos(yaw) * cfg.shoulder,
    y: body.y + eye,
    z: body.z - Math.sin(yaw) * cfg.shoulder,
  };
}

/** Unit look direction (yaw 0 faces −z, counter-clockwise positive; + pitch looks up). */
export function aimDirection(yaw: number, pitch: number): Vec3 {
  const cosP = Math.cos(pitch);
  return { x: -Math.sin(yaw) * cosP, y: Math.sin(pitch), z: -Math.cos(yaw) * cosP };
}

/**
 * Distance along a unit-direction ray to an upright cylinder (side or caps), or
 * undefined if it misses or is beyond `maxDist`. Hit-boxes are cylinders:
 * cheap, and forgiving in the way a capsule is.
 */
export function rayCylinder(
  o: Vec3,
  d: Vec3,
  cx: number,
  cz: number,
  radius: number,
  y0: number,
  y1: number,
  maxDist: number,
): number | undefined {
  const fx = o.x - cx;
  const fz = o.z - cz;
  const insideXZ = fx * fx + fz * fz <= radius * radius;
  if (insideXZ && o.y >= y0 && o.y <= y1) return 0;

  let best: number | undefined;
  const consider = (t: number) => {
    if (t >= 0 && t <= maxDist && (best === undefined || t < best)) best = t;
  };

  const a = d.x * d.x + d.z * d.z;
  if (a > 1e-12) {
    const b = 2 * (fx * d.x + fz * d.z);
    const c = fx * fx + fz * fz - radius * radius;
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const root = Math.sqrt(disc);
      for (const t of [(-b - root) / (2 * a), (-b + root) / (2 * a)]) {
        const y = o.y + d.y * t;
        if (y >= y0 && y <= y1) consider(t);
      }
    }
  }
  if (Math.abs(d.y) > 1e-9) {
    for (const plane of [y0, y1]) {
      const t = (plane - o.y) / d.y;
      const x = o.x + d.x * t - cx;
      const z = o.z + d.z * t - cz;
      if (x * x + z * z <= radius * radius) consider(t);
    }
  }
  return best;
}

export interface ShotTarget {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Current body height (m): crouching targets are shorter. */
  readonly height: number;
}

export interface ShotResult {
  readonly hit: HitKind;
  readonly target: number;
  readonly distance: number;
  readonly end: Vec3;
}

/**
 * One bullet: the nearest of (world, each target) along the ray, within range.
 * Walls block shots, so you cannot hit someone behind cover.
 */
export function resolveShot(
  map: GameMap,
  origin: Vec3,
  dir: Vec3,
  range: number,
  targets: readonly ShotTarget[],
  combat: Pick<CombatSettings, 'bodyRadius' | 'headHeight'>,
): ShotResult {
  const wall = raycastMap(map, origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, range);
  const limit = wall ?? range;

  let bestT = limit;
  let bestTarget: ShotTarget | undefined;
  for (const t of targets) {
    const hit = rayCylinder(origin, dir, t.x, t.z, combat.bodyRadius, t.y, t.y + t.height, bestT);
    if (hit !== undefined && hit <= bestT) {
      bestT = hit;
      bestTarget = t;
    }
  }

  const end = {
    x: origin.x + dir.x * bestT,
    y: origin.y + dir.y * bestT,
    z: origin.z + dir.z * bestT,
  };
  if (!bestTarget) return { hit: 'miss', target: 0, distance: bestT, end };
  const head = end.y >= bestTarget.y + bestTarget.height - combat.headHeight;
  return { hit: head ? 'head' : 'body', target: bestTarget.id, distance: bestT, end };
}
