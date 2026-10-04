/**
 * Moving things (players) bucketed by where they stand, for "who is near
 * here?" without scanning everyone. Cells are square on the ground plane.
 * Pattern: Spatial partitioning (uniform grid) — Why: interest management asks
 * this question for every client every tick; a scan would make it O(players²).
 */
export class SpatialGrid {
  private readonly cells = new Map<number, Set<number>>();
  private readonly where = new Map<number, number>();

  constructor(readonly cellSize: number) {}

  get size(): number {
    return this.where.size;
  }

  cellX(x: number): number {
    return Math.floor(x / this.cellSize);
  }

  private key(cx: number, cz: number): number {
    // Interleave into one number; coordinates stay well within ±32k cells.
    return (cx + 32768) * 65536 + (cz + 32768);
  }

  /** Adds an entity or moves it; cheap when it stays in the same cell. */
  set(id: number, x: number, z: number): void {
    const key = this.key(this.cellX(x), this.cellX(z));
    const previous = this.where.get(id);
    if (previous === key) return;
    if (previous !== undefined) this.cells.get(previous)?.delete(id);
    let cell = this.cells.get(key);
    if (!cell) {
      cell = new Set();
      this.cells.set(key, cell);
    }
    cell.add(id);
    this.where.set(id, key);
  }

  remove(id: number): void {
    const key = this.where.get(id);
    if (key === undefined) return;
    this.cells.get(key)?.delete(id);
    this.where.delete(id);
  }

  /** Calls `visit` for every entity in cells that touch the square of half-width `radius` around (x, z). Callers still check exact distance. */
  forEachNear(x: number, z: number, radius: number, visit: (id: number) => void): void {
    const x0 = this.cellX(x - radius);
    const x1 = this.cellX(x + radius);
    const z0 = this.cellX(z - radius);
    const z1 = this.cellX(z + radius);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const cell = this.cells.get(this.key(cx, cz));
        if (cell) for (const id of cell) visit(id);
      }
    }
  }
}
