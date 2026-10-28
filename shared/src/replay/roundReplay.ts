/**
 * A round, recorded by the server for the teacher to watch afterwards (Phase 35.2): where each
 * student stood every few seconds, seen from above, and the moments that mattered. Only names and
 * places: nothing a student typed is in it.
 */

/** Seconds between position samples. */
export const REPLAY_STEP_SECONDS = 3;
/** Limits that keep one replay small however long the round or big the room. */
export const REPLAY_MAX_TRACKS = 200;
export const REPLAY_MAX_SAMPLES = 600;
export const REPLAY_MAX_EVENTS = 2000;
/** A teacher keeps this many replays per class; older ones are dropped. */
export const REPLAYS_KEPT_PER_CLASS = 10;

export const REPLAY_EVENT_KINDS = [
  'kill',
  'lock',
  'vault',
  'banked',
  'solved',
  'failed',
  'joined',
  'cheat',
] as const;
export type ReplayEventKind = (typeof REPLAY_EVENT_KINDS)[number];

export interface ReplayTrack {
  readonly name: string;
  /** Index of the first sample (a student who joined late starts later). */
  readonly from: number;
  /** x, z in whole metres for each sample, one after another. */
  readonly points: readonly number[];
}

export interface ReplayEvent {
  /** Seconds into the round. */
  readonly at: number;
  readonly kind: ReplayEventKind;
  readonly who: string;
  /** The other side: the victim of a kill. */
  readonly other?: string;
  /** Short detail: the reward key, the amount banked. */
  readonly text?: string;
}

export interface RoundReplay {
  readonly step: number;
  /** How long the round ran (s). */
  readonly seconds: number;
  readonly tracks: readonly ReplayTrack[];
  readonly events: readonly ReplayEvent[];
}

/** Where everyone is `seconds` into the round (a student who has left stays where they were last seen). */
export function replayPositions(
  replay: RoundReplay,
  seconds: number,
): { readonly name: string; readonly x: number; readonly z: number }[] {
  const f = Math.max(0, seconds) / replay.step;
  const out: { name: string; x: number; z: number }[] = [];
  for (const t of replay.tracks) {
    const n = Math.floor(t.points.length / 2);
    if (n === 0 || f < t.from) continue;
    const i = Math.min(n - 1, Math.floor(f) - t.from);
    const j = Math.min(n - 1, i + 1);
    const k = Math.min(1, f - Math.floor(f));
    const p = (s: number, o: number) => t.points[s * 2 + o] as number;
    out.push({
      name: t.name,
      x: p(i, 0) + (p(j, 0) - p(i, 0)) * k,
      z: p(i, 1) + (p(j, 1) - p(i, 1)) * k,
    });
  }
  return out;
}
