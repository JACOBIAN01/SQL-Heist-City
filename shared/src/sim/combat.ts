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
  return aimOriginInto({ x: 0, y: 0, z: 0 }, body, yaw, cfg);
}

/** Same as {@link aimOrigin} but writes into `out` (the server fires many shots per tick). */
export function aimOriginInto(
  out: Vec3,
  body: { x: number; y: number; z: number; crouching: boolean },
  yaw: number,
  cfg: MovementSettings,
): Vec3 {
  const eye = body.crouching ? cfg.crouchEyeHeight : cfg.eyeHeight;
  out.x = body.x + Math.cos(yaw) * cfg.shoulder;
  out.y = body.y + eye;
  out.z = body.z - Math.sin(yaw) * cfg.shoulder;
  return out;
}

/** Unit look direction (yaw 0 faces −z, counter-clockwise positive; + pitch looks up). */
export function aimDirection(yaw: number, pitch: number): Vec3 {
  return aimDirectionInto({ x: 0, y: 0, z: 0 }, yaw, pitch);
}

export function aimDirectionInto(out: Vec3, yaw: number, pitch: number): Vec3 {
  const cosP = Math.cos(pitch);
  out.x = -Math.sin(yaw) * cosP;
  out.y = Math.sin(pitch);
  out.z = -Math.cos(yaw) * cosP;
  return out;
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
  const r2 = radius * radius;
  if (fx * fx + fz * fz <= r2 && o.y >= y0 && o.y <= y1) return 0;

  let best = Infinity;

  // Side wall: solve |(o + t d) − axis|² = r² in the ground plane, then check the height.
  const a = d.x * d.x + d.z * d.z;
  if (a > 1e-12) {
    const b = 2 * (fx * d.x + fz * d.z);
    const c = fx * fx + fz * fz - r2;
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const root = Math.sqrt(disc);
      const t1 = (-b - root) / (2 * a);
      const t2 = (-b + root) / (2 * a);
      if (t1 >= 0 && t1 <= maxDist && t1 < best) {
        const y = o.y + d.y * t1;
        if (y >= y0 && y <= y1) best = t1;
      }
      if (t2 >= 0 && t2 <= maxDist && t2 < best) {
        const y = o.y + d.y * t2;
        if (y >= y0 && y <= y1) best = t2;
      }
    }
  }

  // Caps (bottom and top discs).
  if (Math.abs(d.y) > 1e-9) {
    const tb = (y0 - o.y) / d.y;
    if (tb >= 0 && tb <= maxDist && tb < best) {
      const x = o.x + d.x * tb - cx;
      const z = o.z + d.z * tb - cz;
      if (x * x + z * z <= r2) best = tb;
    }
    const tt = (y1 - o.y) / d.y;
    if (tt >= 0 && tt <= maxDist && tt < best) {
      const x = o.x + d.x * tt - cx;
      const z = o.z + d.z * tt - cz;
      if (x * x + z * z <= r2) best = tt;
    }
  }
  return best === Infinity ? undefined : best;
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
  hit: HitKind;
  target: number;
  distance: number;
  readonly end: Vec3;
}

export const newShotResult = (): ShotResult => ({
  hit: 'miss',
  target: 0,
  distance: 0,
  end: { x: 0, y: 0, z: 0 },
});

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
  return resolveShotInto(newShotResult(), map, origin, dir, range, targets, combat);
}

/** Same as {@link resolveShot} but fills a caller-owned result instead of allocating one. */
export function resolveShotInto(
  result: ShotResult,
  map: GameMap,
  origin: Vec3,
  dir: Vec3,
  range: number,
  targets: readonly ShotTarget[],
  combat: Pick<CombatSettings, 'bodyRadius' | 'headHeight'>,
  /** How many entries of `targets` are live (lets callers reuse a longer array). */
  targetCount = targets.length,
): ShotResult {
  const wall = raycastMap(map, origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, range);
  const limit = wall ?? range;

  let bestT = limit;
  let bestTarget: ShotTarget | undefined;
  for (let i = 0; i < targetCount; i++) {
    const t = targets[i] as ShotTarget;
    const hit = rayCylinder(origin, dir, t.x, t.z, combat.bodyRadius, t.y, t.y + t.height, bestT);
    if (hit !== undefined && hit <= bestT) {
      bestT = hit;
      bestTarget = t;
    }
  }

  result.distance = bestT;
  result.end.x = origin.x + dir.x * bestT;
  result.end.y = origin.y + dir.y * bestT;
  result.end.z = origin.z + dir.z * bestT;
  if (!bestTarget) {
    result.hit = 'miss';
    result.target = 0;
    return result;
  }
  const head = result.end.y >= bestTarget.y + bestTarget.height - combat.headHeight;
  result.hit = head ? 'head' : 'body';
  result.target = bestTarget.id;
  return result;
}
