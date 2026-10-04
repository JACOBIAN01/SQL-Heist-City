import { SpatialGrid, type InterestSettings } from '@heist/shared';

export interface Viewer {
  readonly id: number;
  readonly x: number;
  readonly z: number;
  /** Tick at which each other player was last sent to this viewer. Owned and updated here. */
  readonly lastSent: Map<number, number>;
}

interface Candidate {
  id: number;
  dist2: number;
}

const byDistance = (a: Candidate, b: Candidate) => a.dist2 - b.dist2;

/**
 * Decides, per viewer per tick, which other players to include in their
 * snapshot. Close players update every tick, further ones less often, far
 * ones barely, and beyond a limit not at all — most of what a 100-player
 * match would otherwise send is players nobody can see.
 * Pattern: Strategy-ish policy object — Why: tiers, ranges and caps are
 * config (`interestSettingsSchema`), so tuning is a settings change.
 */
export class InterestManager {
  readonly grid: SpatialGrid;
  private readonly candidates: Candidate[] = [];

  constructor(private readonly cfg: InterestSettings) {
    // One grid cell per `nearRange` keeps neighbour lookups to a few cells.
    this.grid = new SpatialGrid(Math.max(16, cfg.nearRange));
  }

  update(id: number, x: number, z: number): void {
    this.grid.set(id, x, z);
  }

  remove(id: number): void {
    this.grid.remove(id);
  }

  /**
   * Appends to `out` the ids that should be sent to `viewer` on `tick`, nearest
   * first, and updates what the viewer is known to have.
   */
  select(
    viewer: Viewer,
    tick: number,
    positionOf: (id: number) => { x: number; z: number } | undefined,
    out: number[],
  ): void {
    const { cfg } = this;
    const far2 = cfg.farRange * cfg.farRange;
    const list = this.candidates;
    list.length = 0;
    this.grid.forEachNear(viewer.x, viewer.z, cfg.farRange, (id) => {
      if (id === viewer.id) return;
      const p = positionOf(id);
      if (!p) return;
      const dx = p.x - viewer.x;
      const dz = p.z - viewer.z;
      const dist2 = dx * dx + dz * dz;
      if (dist2 <= far2) list.push({ id, dist2 });
    });
    list.sort(byDistance);
    if (list.length > cfg.maxEntities) list.length = cfg.maxEntities;

    const near2 = cfg.nearRange * cfg.nearRange;
    const mid2 = cfg.midRange * cfg.midRange;
    const inRange = new Set<number>();
    for (const c of list) {
      inRange.add(c.id);
      const every = c.dist2 <= near2 ? 1 : c.dist2 <= mid2 ? cfg.midEvery : cfg.farEvery;
      const last = viewer.lastSent.get(c.id);
      // New to this viewer → send now, whatever the phase; otherwise when its interval has elapsed.
      if (last === undefined || tick - last >= every) {
        out.push(c.id);
        viewer.lastSent.set(c.id, tick);
      }
    }
    // Anyone who left range is forgotten, so they are sent immediately if they come back.
    for (const id of viewer.lastSent.keys()) if (!inRange.has(id)) viewer.lastSent.delete(id);
  }

  /** Visits everyone within `range` of a point (exact distance is up to the caller). */
  forEachNear(x: number, z: number, range: number, visit: (id: number) => void): void {
    this.grid.forEachNear(x, z, range, visit);
  }
}
