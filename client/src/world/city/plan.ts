import type { Rect } from '@heist/shared';

/**
 * What a chunk of city art is made of, before any geometry exists. Pure data,
 * so the grammar can be tested without WebGL and merged in one pass.
 */

/** Quarter turns about y. A kit piece faces +z; turn t faces it (sin t·90°, cos t·90°). */
export type Turn = 0 | 1 | 2 | 3;

export interface Placement {
  readonly piece: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly turn: Turn;
  /** Texture layer replacing the window's default fake interior. */
  readonly interior?: string;
}

/** A horizontal surface facing up (road, sidewalk top, lot paving, roof). UVs are world-space. */
export interface GroundQuad {
  readonly rect: Rect;
  readonly y: number;
  readonly layer: string;
  /** Metres per texture repeat. */
  readonly tile: number;
}

/** A vertical quad from `from` to `to`; it faces to the right of that direction (see wallNormal). */
export interface WallQuad {
  readonly from: { readonly x: number; readonly z: number };
  readonly to: { readonly x: number; readonly z: number };
  readonly bottom: number;
  readonly top: number;
  readonly layer: string;
  readonly tile: number;
}

export interface ChunkPlan {
  readonly id: string;
  /** The ground this chunk owns: its block and the streets to its north and west (and the outer ring at the edge). */
  readonly bounds: Rect;
  readonly placements: readonly Placement[];
  readonly ground: readonly GroundQuad[];
  readonly walls: readonly WallQuad[];
}

/** Outward normal of a piece turned by `turn`. */
export function turnNormal(turn: Turn): { x: number; z: number } {
  return [
    { x: 0, z: 1 },
    { x: 1, z: 0 },
    { x: 0, z: -1 },
    { x: -1, z: 0 },
  ][turn] as { x: number; z: number };
}

/** Where a piece's own +x points after `turn` (the direction modules are laid along a side). */
export function turnAlong(turn: Turn): { x: number; z: number } {
  return [
    { x: 1, z: 0 },
    { x: 0, z: -1 },
    { x: -1, z: 0 },
    { x: 0, z: 1 },
  ][turn] as { x: number; z: number };
}

/** The side a wall quad faces: the right-hand side of from → to, seen from above (y up). */
export function wallNormal(w: WallQuad): { x: number; z: number } {
  const dx = w.to.x - w.from.x;
  const dz = w.to.z - w.from.z;
  const len = Math.hypot(dx, dz) || 1;
  return { x: -dz / len, z: dx / len };
}

/**
 * `rect` minus the holes, as non-overlapping rectangles (axis-aligned, so a
 * grid of the cut lines is enough). Used for asphalt around a block and the
 * alleys between lots.
 */
export function subtractRects(rect: Rect, holes: readonly Rect[]): Rect[] {
  const xs = [...new Set([rect.minX, rect.maxX, ...holes.flatMap((h) => [h.minX, h.maxX])])]
    .filter((x) => x >= rect.minX && x <= rect.maxX)
    .sort((a, b) => a - b);
  const zs = [...new Set([rect.minZ, rect.maxZ, ...holes.flatMap((h) => [h.minZ, h.maxZ])])]
    .filter((z) => z >= rect.minZ && z <= rect.maxZ)
    .sort((a, b) => a - b);
  const out: Rect[] = [];
  for (let j = 0; j + 1 < zs.length; j++) {
    // Merge runs of free cells along x into one strip per row.
    let start: number | undefined;
    for (let i = 0; i + 1 <= xs.length; i++) {
      const minX = xs[i] as number;
      const maxX = xs[i + 1];
      const minZ = zs[j] as number;
      const maxZ = zs[j + 1] as number;
      const free =
        maxX !== undefined &&
        !holes.some((h) => h.minX <= minX && h.maxX >= maxX && h.minZ <= minZ && h.maxZ >= maxZ);
      if (free && start === undefined) start = minX;
      if (!free && start !== undefined) {
        out.push({ minX: start, maxX: minX, minZ, maxZ });
        start = undefined;
      }
    }
  }
  return out;
}
