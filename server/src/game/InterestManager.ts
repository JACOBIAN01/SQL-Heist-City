import { SpatialGrid, type InterestSettings } from '@heist/shared';

/** What a viewer knows about one other player. Updated in place. */
export interface SentInfo {
  readonly id: number;
  /** Tick this player was last sent to the viewer. */
  tick: number;
  /** Marks "still in range" during a `select` pass (see {@link InterestManager.select}). */
  stamp: number;
}

export interface Viewer {
  readonly id: number;
  readonly x: number;
  readonly z: number;
  /** What this viewer has been told about each other player. Owned and updated here. */
  readonly lastSent: Map<number, SentInfo>;
}

/**
 * Decides, per viewer per tick, which other players to include in their
 * snapshot. Close players update every tick, further ones less often, far
 * ones barely, and beyond a limit not at all — most of what a 100-player
 * match would otherwise send is players nobody can see.
 * Pattern: Strategy-ish policy object — Why: tiers, ranges and caps are
 * config (`interestSettingsSchema`), so tuning is a settings change.
 *
 * It runs once per client per tick, so it works in preallocated arrays (the
 * nearest `maxEntities` are kept by insertion, not by sorting objects).
 */
export class InterestManager {
  readonly grid: SpatialGrid;
  private readonly near: number[] = [];
  /** How many entries of the `out` / `removed` arrays the last {@link select} wrote. */
  selected = 0;
  removedCount = 0;
  private readonly pickedId: Int32Array;
  private readonly pickedDist2: Float64Array;
  private stamp = 0;

  constructor(private readonly cfg: InterestSettings) {
    // One grid cell per `nearRange` keeps neighbour lookups to a few cells.
    this.grid = new SpatialGrid(Math.max(16, cfg.nearRange));
    this.pickedId = new Int32Array(cfg.maxEntities);
    this.pickedDist2 = new Float64Array(cfg.maxEntities);
  }

  update(id: number, x: number, z: number): void {
    this.grid.set(id, x, z);
  }

  remove(id: number): void {
    this.grid.remove(id);
  }

  /**
   * Writes into `out` (from index 0) the ids that should be sent to `viewer` on
   * `tick`, nearest first, and into `removed` the ids that just left the viewer's
   * range (the client must forget them); `selected` and `removedCount` say how many.
   * Updates what the viewer is known to have. Arrays are written by index and never
   * shrunk, so repeated calls allocate nothing.
   */
  select(
    viewer: Viewer,
    tick: number,
    positionOf: (id: number) => { x: number; z: number } | undefined,
    out: number[],
    removed: number[],
  ): void {
    const { cfg } = this;
    const far2 = cfg.farRange * cfg.farRange;
    const cap = cfg.maxEntities;
    const ids = this.pickedId;
    const d2s = this.pickedDist2;
    let n = 0;

    const candidates = this.near;
    const found = this.grid.collectNear(viewer.x, viewer.z, cfg.farRange, candidates);
    for (let c = 0; c < found; c++) {
      const id = candidates[c] as number;
      if (id === viewer.id) continue;
      const p = positionOf(id);
      if (!p) continue;
      const dx = p.x - viewer.x;
      const dz = p.z - viewer.z;
      const dist2 = dx * dx + dz * dz;
      if (dist2 > far2) continue;
      // Keep the `cap` nearest, sorted, by insertion.
      if (n === cap && dist2 >= (d2s[n - 1] as number)) continue;
      let k = n < cap ? n++ : n - 1;
      while (k > 0 && (d2s[k - 1] as number) > dist2) {
        d2s[k] = d2s[k - 1] as number;
        ids[k] = ids[k - 1] as number;
        k--;
      }
      d2s[k] = dist2;
      ids[k] = id;
    }

    const near2 = cfg.nearRange * cfg.nearRange;
    const mid2 = cfg.midRange * cfg.midRange;
    const stamp = ++this.stamp;
    let outCount = 0;
    let removedCount = 0;
    for (let i = 0; i < n; i++) {
      const id = ids[i] as number;
      const dist2 = d2s[i] as number;
      const every = dist2 <= near2 ? 1 : dist2 <= mid2 ? cfg.midEvery : cfg.farEvery;
      const info = viewer.lastSent.get(id);
      if (!info) {
        // New to this viewer → send now, whatever the phase.
        viewer.lastSent.set(id, { id, tick, stamp });
        out[outCount++] = id;
      } else {
        info.stamp = stamp;
        if (tick - info.tick >= every) {
          info.tick = tick;
          out[outCount++] = id;
        }
      }
    }
    // Anyone not seen this pass left range: forget them (they are sent at once if they return).
    for (const info of viewer.lastSent.values()) {
      if (info.stamp === stamp) continue;
      viewer.lastSent.delete(info.id);
      removed[removedCount++] = info.id;
    }
    this.selected = outCount;
    this.removedCount = removedCount;
  }

  /** Visits everyone within `range` of a point (exact distance is up to the caller). */
  forEachNear(x: number, z: number, range: number, visit: (id: number) => void): void {
    this.grid.forEachNear(x, z, range, visit);
  }
}
