import type { TrafficSettings } from '../config/vehicles';

/**
 * The rules of the road for the city's traffic (Phase 29.2), as plain functions with no cars in
 * them, so they can be checked on their own. World axes: x east, z south; a car facing +z is
 * going south. Traffic keeps to the right.
 */

/** A lane: one direction of one street. */
export interface Lane {
  /** Vertical streets run north–south (along z); horizontal ones east–west (along x). */
  readonly vertical: boolean;
  /** Which street line (an index into streetLinesX for vertical, streetLinesZ for horizontal). */
  readonly line: number;
  /** +1 towards larger x/z, −1 towards smaller. */
  readonly dir: 1 | -1;
}

/** Where the centre of a lane is, across the street. Right-hand traffic: facing south, west is on your right. */
export function laneCentre(
  lane: Lane,
  lines: { x: readonly number[]; z: readonly number[] },
  offset: number,
): number {
  if (lane.vertical) return (lines.x[lane.line] as number) + (lane.dir === 1 ? -offset : offset);
  return (lines.z[lane.line] as number) + (lane.dir === 1 ? offset : -offset);
}

/** A direction as (dx, dz). */
export const headingOf = (lane: Lane): { x: number; z: number } =>
  lane.vertical ? { x: 0, z: lane.dir } : { x: lane.dir, z: 0 };

/** Turning right, as seen from above with x east and z south. */
export const turnRight = (v: { x: number; z: number }): { x: number; z: number } => ({
  x: -v.z,
  z: v.x,
});
export const turnLeft = (v: { x: number; z: number }): { x: number; z: number } => ({
  x: v.z,
  z: -v.x,
});

/** The lane that travels in direction `v` on the street through junction (i, j). */
export function laneGoing(v: { x: number; z: number }, i: number, j: number): Lane {
  return v.x !== 0
    ? { vertical: false, line: j, dir: v.x > 0 ? 1 : -1 }
    : { vertical: true, line: i, dir: v.z > 0 ? 1 : -1 };
}

/**
 * Whose turn it is at a junction: north–south, east–west, or nobody (all red while the junction
 * clears). Junctions are offset from one another so a whole street is not red at once.
 */
export function signalAt(
  time: number,
  i: number,
  j: number,
  s: Pick<TrafficSettings, 'greenSeconds' | 'clearSeconds'>,
): 'vertical' | 'horizontal' | 'none' {
  const half = s.greenSeconds + s.clearSeconds;
  const cycle = 2 * half;
  const t = (((time + (i * 3 + j * 5) * 1.7) % cycle) + cycle) % cycle;
  if (t < s.greenSeconds) return 'vertical';
  if (t >= half && t < half + s.greenSeconds) return 'horizontal';
  return 'none';
}

/** Whether a car on this lane may enter the junction now. */
export const mayEnter = (lane: Lane, signal: ReturnType<typeof signalAt>): boolean =>
  signal === (lane.vertical ? 'vertical' : 'horizontal');

/** The speed from which a car can still stop in `gap` metres braking at `decel`. */
export const safeSpeed = (gap: number, decel: number): number =>
  Math.sqrt(2 * decel * Math.max(0, gap));

/** The car's yaw (0 faces −z) for a heading vector. */
export const yawOf = (v: { x: number; z: number }): number => Math.atan2(-v.x, -v.z);

/** An angle brought into (−π, π]. */
export function wrap(angle: number): number {
  let a = angle;
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a <= -Math.PI) a += 2 * Math.PI;
  return a;
}
