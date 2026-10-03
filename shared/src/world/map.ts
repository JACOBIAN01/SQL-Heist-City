/**
 * Static world geometry shared by server (collisions, line of sight) and
 * client (rendering). One definition means what you see is what blocks you.
 * Axis-aligned boxes only: cheap to test and enough for a blocky city.
 */
export interface Aabb {
  readonly minX: number;
  readonly minY: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly maxZ: number;
}

/** Drives the client's material only; the server treats every kind the same. */
export type MapBoxKind = 'wall' | 'building' | 'crate' | 'step' | 'cover';

export interface MapBox extends Aabb {
  readonly kind: MapBoxKind;
}

export interface SpawnPoint {
  readonly x: number;
  readonly z: number;
  /** Facing, radians. */
  readonly yaw: number;
}

export interface GameMap {
  readonly id: string;
  /** The ground plane (y = 0) spans [-halfSize, halfSize] on x and z. */
  readonly halfSize: number;
  readonly boxes: readonly MapBox[];
  readonly spawns: readonly SpawnPoint[];
}

/** Box from its footprint centre, ground-relative bottom and size. */
export function box(
  kind: MapBoxKind,
  x: number,
  z: number,
  width: number,
  height: number,
  depth: number,
  bottom = 0,
): MapBox {
  return {
    kind,
    minX: x - width / 2,
    maxX: x + width / 2,
    minY: bottom,
    maxY: bottom + height,
    minZ: z - depth / 2,
    maxZ: z + depth / 2,
  };
}
