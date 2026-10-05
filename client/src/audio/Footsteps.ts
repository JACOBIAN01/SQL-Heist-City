import {
  colliderGridFor,
  strideAt,
  type Aabb,
  type AudioSettings,
  type GameMap,
  type MapBox,
} from '@heist/shared';
import type { StepSurface } from './synth';

/** Moving further than this (m) between two looks is a teleport (respawn, lift), not walking. */
const TELEPORT = 3;
/** How close (m) the feet must be to a box's top to be standing on it. */
const ON_TOP = 0.08;

/**
 * Paces one body's footsteps: one step every stride of ground covered, the
 * stride growing with speed (a sprint is fewer, longer strides). Works from
 * positions alone, so it serves the local player and everyone seen over the
 * network alike.
 */
export class FootstepTracker {
  private last: { x: number; z: number } | undefined;
  private travelled = 0;
  private airborne = false;

  constructor(private readonly settings: AudioSettings) {}

  /** True when a foot lands now: a stride was completed, or the body landed from a jump. */
  update(x: number, z: number, onGround: boolean, dtSeconds: number): boolean {
    const last = this.last;
    this.last = { x, z };
    if (!last || dtSeconds <= 0) return false;
    const moved = Math.hypot(x - last.x, z - last.z);
    if (moved > TELEPORT) {
      this.travelled = 0;
      return false;
    }
    if (!onGround) {
      this.airborne = true;
      return false;
    }
    if (this.airborne) {
      this.airborne = false;
      this.travelled = 0;
      return true;
    }
    if (moved === 0) {
      // Standing still: the next step starts half a stride in, like starting to walk.
      this.travelled = Math.min(this.travelled, strideAt(0, this.settings) / 2);
      return false;
    }
    this.travelled += moved;
    const stride = strideAt(moved / dtSeconds, this.settings);
    if (this.travelled < stride) return false;
    this.travelled -= stride;
    return true;
  }
}

const near: Aabb[] = [];

/** What a body standing at (x, y, z) has under its feet. */
export function surfaceAt(map: GameMap, x: number, y: number, z: number): StepSurface {
  if (y < ON_TOP) return 'concrete';
  const n = colliderGridFor(map).query(x, z, x, z, near);
  for (let i = 0; i < n; i++) {
    const b = near[i] as MapBox;
    if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) continue;
    if (Math.abs(b.maxY - y) > ON_TOP) continue;
    switch (b.kind) {
      case 'crate':
      case 'cover':
        return 'metal';
      case 'interior':
      case 'step':
      case 'building':
        return 'tile';
      default:
        return 'concrete';
    }
  }
  return 'concrete';
}
