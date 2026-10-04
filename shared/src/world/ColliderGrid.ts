import { rayAabb } from './rayAabb';
import type { Aabb, GameMap } from './map';

/**
 * Static boxes bucketed into a uniform grid on the ground plane, so movement
 * and shots only look at boxes near them instead of every box in the city
 * (a city has 500–1000; a body only ever touches a handful).
 * Pattern: Spatial partitioning (uniform grid) — Why: lookup cost depends on
 * how crowded a spot is, not on how big the map is, which is what lets the
 * city grow without slowing the 20 Hz tick (docs/city-kit.md §5).
 */
export class ColliderGrid {
  private readonly cells: number[][];
  private readonly size: number;
  private readonly origin: number;
  /** Per-box "already seen in this query" marker, so a box spanning cells is reported once. */
  private readonly seen: Uint32Array;
  private stamp = 0;

  constructor(
    private readonly boxes: readonly Aabb[],
    halfSize: number,
    private readonly cellSize = 8,
  ) {
    // A margin of one cell so boundary walls just outside ±halfSize still land in a cell.
    this.origin = -halfSize - cellSize;
    this.size = Math.ceil((halfSize * 2 + cellSize * 2) / cellSize) + 1;
    this.cells = Array.from({ length: this.size * this.size }, () => []);
    this.seen = new Uint32Array(boxes.length);
    boxes.forEach((b, index) => {
      const [x0, z0] = [this.cellOf(b.minX), this.cellOf(b.minZ)];
      const [x1, z1] = [this.cellOf(b.maxX), this.cellOf(b.maxZ)];
      for (let cx = x0; cx <= x1; cx++)
        for (let cz = z0; cz <= z1; cz++) this.cells[cx * this.size + cz]?.push(index);
    });
  }

  private cellOf(v: number): number {
    return Math.min(this.size - 1, Math.max(0, Math.floor((v - this.origin) / this.cellSize)));
  }

  /**
   * Fills `out` with every box whose footprint may touch the rectangle and
   * returns how many. `out` is reused by the caller, so this allocates nothing.
   */
  query(minX: number, minZ: number, maxX: number, maxZ: number, out: Aabb[]): number {
    this.stamp++;
    let n = 0;
    const [x0, z0] = [this.cellOf(minX), this.cellOf(minZ)];
    const [x1, z1] = [this.cellOf(maxX), this.cellOf(maxZ)];
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        for (const index of this.cells[cx * this.size + cz] ?? []) {
          if (this.seen[index] === this.stamp) continue;
          this.seen[index] = this.stamp;
          out[n++] = this.boxes[index] as Aabb;
        }
      }
    }
    out.length = n;
    return n;
  }

  /** Nearest box hit along a unit-direction ray (cell-by-cell walk, stopping at the first cell that cannot beat the best hit). */
  raycast(
    ox: number,
    oy: number,
    oz: number,
    dx: number,
    dy: number,
    dz: number,
    maxDist: number,
  ): number | undefined {
    this.stamp++;
    let best: number | undefined;
    let cx = this.cellOf(ox);
    let cz = this.cellOf(oz);
    const stepX = dx > 0 ? 1 : -1;
    const stepZ = dz > 0 ? 1 : -1;
    const nextBoundary = (cell: number, step: number) =>
      this.origin + (step > 0 ? cell + 1 : cell) * this.cellSize;
    let tMaxX = dx === 0 ? Infinity : (nextBoundary(cx, stepX) - ox) / dx;
    let tMaxZ = dz === 0 ? Infinity : (nextBoundary(cz, stepZ) - oz) / dz;
    const tDeltaX = dx === 0 ? Infinity : this.cellSize / Math.abs(dx);
    const tDeltaZ = dz === 0 ? Infinity : this.cellSize / Math.abs(dz);

    for (let guard = 0; guard < this.size * 2 + 2; guard++) {
      for (const index of this.cells[cx * this.size + cz] ?? []) {
        if (this.seen[index] === this.stamp) continue;
        this.seen[index] = this.stamp;
        const t = rayAabb(ox, oy, oz, dx, dy, dz, this.boxes[index] as Aabb, best ?? maxDist);
        if (t !== undefined && (best === undefined || t < best)) best = t;
      }
      const exit = Math.min(tMaxX, tMaxZ);
      if (exit > (best ?? maxDist)) break;
      if (tMaxX < tMaxZ) {
        cx += stepX;
        tMaxX += tDeltaX;
      } else {
        cz += stepZ;
        tMaxZ += tDeltaZ;
      }
      if (cx < 0 || cz < 0 || cx >= this.size || cz >= this.size) break;
    }
    return best;
  }
}

const grids = new WeakMap<GameMap, ColliderGrid>();

/** One grid per map, built on first use. */
export function colliderGridFor(map: GameMap): ColliderGrid {
  let grid = grids.get(map);
  if (!grid) {
    grid = new ColliderGrid(map.boxes, map.halfSize);
    grids.set(map, grid);
  }
  return grid;
}
