import type { Aabb } from '../map';
import { SLAB_THICKNESS, type BankLayout, type Heading, type Point2 } from './BankLayout';
import { FURNITURE_PIECES, isFurniturePiece } from './furniturePieces';

/** Yaw (radians about y, three.js convention) that turns a piece's front (+z) to face `h`. */
export const FACING_YAW: Readonly<Record<Heading, number>> = {
  '+z': 0,
  '+x': Math.PI / 2,
  '-z': Math.PI,
  '-x': -Math.PI / 2,
};

/** One piece of furniture where it stands in the world. */
export interface PlacedFurniture {
  readonly piece: string;
  readonly storey: number;
  /** World position of the piece's origin (its base, or the ceiling for hanging lights). */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  readonly scale: number;
  readonly solid: boolean;
  readonly desk: boolean;
  /** World bounds after turning and scaling. */
  readonly bounds: Aabb;
}

/** Height of a storey's ceiling above its floor: the slab above, or the roof on the top storey. */
export function ceilingHeight(layout: BankLayout, storey: number): number {
  return storey < layout.storeys - 1 ? layout.storeyHeight - SLAB_THICKNESS : layout.storeyHeight;
}

/** A piece's local bounds turned to face `facing` (quarter turns only, so they stay boxes). */
function turned(
  min: readonly number[],
  max: readonly number[],
  facing: Heading,
): { minX: number; maxX: number; minZ: number; maxZ: number } {
  const [x0 = 0, , z0 = 0] = min;
  const [x1 = 0, , z1 = 0] = max;
  switch (facing) {
    case '+z':
      return { minX: x0, maxX: x1, minZ: z0, maxZ: z1 };
    case '-z':
      return { minX: -x1, maxX: -x0, minZ: -z1, maxZ: -z0 };
    // yaw +90°: (x, z) → (z, −x)
    case '+x':
      return { minX: z0, maxX: z1, minZ: -x1, maxZ: -x0 };
    // yaw −90°: (x, z) → (−z, x)
    case '-x':
      return { minX: -z1, maxX: -z0, minZ: x0, maxZ: x1 };
  }
}

/**
 * Where every piece of a bank's furniture stands, in world coordinates. The
 * server turns the solid ones into colliders and the client draws them all
 * from this same list, so the art and the geometry cannot drift apart.
 */
export function placeFurniture(layout: BankLayout, at: Point2): PlacedFurniture[] {
  return (layout.furniture ?? []).map((f) => {
    if (!isFurniturePiece(f.piece)) throw new Error(`bank ${layout.id}: unknown piece ${f.piece}`);
    const piece = FURNITURE_PIECES[f.piece];
    const scale = f.scale ?? 1;
    const facing = f.facing ?? '+z';
    const floor = f.storey * layout.storeyHeight;
    const hangs = 'hangs' in piece && piece.hangs;
    const y = hangs ? floor + ceilingHeight(layout, f.storey) : floor + (f.y ?? 0);
    const r = turned(
      piece.min.map((n) => n * scale),
      piece.max.map((n) => n * scale),
      facing,
    );
    const x = at.x + f.x;
    const z = at.z + f.z;
    return {
      piece: f.piece,
      storey: f.storey,
      x,
      y,
      z,
      yaw: FACING_YAW[facing],
      scale,
      solid: f.solid ?? false,
      desk: f.desk ?? false,
      bounds: {
        minX: x + r.minX,
        maxX: x + r.maxX,
        minY: y + piece.min[1] * scale,
        maxY: y + piece.max[1] * scale,
        minZ: z + r.minZ,
        maxZ: z + r.maxZ,
      },
    };
  });
}
