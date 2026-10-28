/**
 * A ghost heist (Phase 34.6): a player's run, kept as where they stood each second, to be replayed
 * as a ghost for the next player to beat. The trace is flat numbers (x, y, z for each second).
 */
export interface GhostTrace {
  /** Seconds between samples. */
  readonly step: number;
  /** x, y, z of each sample, one after another. */
  readonly points: readonly number[];
}

/** Where the ghost is `seconds` into its run (it stops at its last sample). */
export function ghostAt(
  trace: GhostTrace,
  seconds: number,
): { readonly x: number; readonly y: number; readonly z: number } | undefined {
  const n = Math.floor(trace.points.length / 3);
  if (n === 0) return undefined;
  const f = Math.max(0, seconds) / trace.step;
  const i = Math.min(n - 1, Math.floor(f));
  const j = Math.min(n - 1, i + 1);
  const t = Math.min(1, f - i);
  const p = (k: number, o: number) => trace.points[k * 3 + o] as number;
  return {
    x: p(i, 0) + (p(j, 0) - p(i, 0)) * t,
    y: p(i, 1) + (p(j, 1) - p(i, 1)) * t,
    z: p(i, 2) + (p(j, 2) - p(i, 2)) * t,
  };
}

/** The most seconds of a run that is kept (ten minutes): a ghost is a lap, not a whole round. */
export const GHOST_MAX_SECONDS = 600;
