/**
 * Moving things (players) bucketed by where they stand, for "who is near
 * here?" without scanning everyone. Cells are square on the ground plane.
 * Pattern: Spatial partitioning (uniform grid) — Why: interest management asks
 * this question for every client every tick; a scan would make it O(players²).
 */
export class SpatialGrid {
  private readonly cells = new Map<number, number[]>();
  private readonly where = new Map<number, number>();
  private readonly visitScratch: number[] = [];

  constructor(readonly cellSize: number) {}

  get size(): number {
    return this.where.size;
  }

  cellX(x: number): number {
    return Math.floor(x / this.cellSize);
  }

  private key(cx: number, cz: number): number {
    // Packed into 20 bits so the key is a small integer: larger numbers are boxed
    // on the heap every time they are computed, which allocated on every lookup.
    // ±512 cells is ±32 km at 64 m cells.
    return ((cx + 512) << 10) | (cz + 512);
  }

  /** Removes `id` from a cell (swap with the last entry: order does not matter). */
  private take(key: number, id: number): void {
    const cell = this.cells.get(key);
    if (!cell) return;
    const at = cell.indexOf(id);
    if (at < 0) return;
    cell[at] = cell[cell.length - 1] as number;
    cell.pop();
  }

  /** Adds an entity or moves it; cheap when it stays in the same cell. */
  set(id: number, x: number, z: number): void {
    const key = this.key(this.cellX(x), this.cellX(z));
    const previous = this.where.get(id);
    if (previous === key) return;
    if (previous !== undefined) this.take(previous, id);
    let cell = this.cells.get(key);
    if (!cell) {
      cell = [];
      this.cells.set(key, cell);
    }
    cell.push(id);
    this.where.set(id, key);
  }

  remove(id: number): void {
    const key = this.where.get(id);
    if (key === undefined) return;
    this.take(key, id);
    this.where.delete(id);
  }

  /**
   * Writes the ids of every entity in cells touching the square of half-width
   * `radius` into `out` (from index 0) and returns how many. Writes by index into
   * a caller-owned array, so nothing is allocated and `out` is never shrunk.
   */
  collectNear(x: number, z: number, radius: number, out: number[]): number {
    const x0 = this.cellX(x - radius);
    const x1 = this.cellX(x + radius);
    const z0 = this.cellX(z - radius);
    const z1 = this.cellX(z + radius);
    let n = 0;
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const cell = this.cells.get(this.key(cx, cz));
        if (cell) for (let i = 0; i < cell.length; i++) out[n++] = cell[i] as number;
      }
    }
    return n;
  }

  /** Calls `visit` for every entity in cells that touch the square of half-width `radius` around (x, z). Callers still check exact distance. */
  forEachNear(x: number, z: number, radius: number, visit: (id: number) => void): void {
    const n = this.collectNear(x, z, radius, this.visitScratch);
    for (let i = 0; i < n; i++) visit(this.visitScratch[i] as number);
  }
}
