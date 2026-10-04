export interface Pose {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  readonly pitch: number;
  readonly flags: number;
  readonly hp: number;
}

export interface SampledPose extends Pose {
  /** Horizontal speed implied by the two samples blended, m/s (drives walk/run animation). */
  readonly speed: number;
}

interface Sample {
  readonly time: number;
  readonly pose: Pose;
}

const TAU = Math.PI * 2;
const MAX_INTERVAL_MS = 1000;

/** Shortest-way blend between two angles in radians, so 359° → 1° does not spin the long way round. */
export function lerpAngle(from: number, to: number, t: number): number {
  let delta = (to - from) % TAU;
  if (delta > Math.PI) delta -= TAU;
  else if (delta < -Math.PI) delta += TAU;
  return from + delta * t;
}

/**
 * Buffer of one entity's recent server states, sampled at a time slightly in
 * the past. Rendering "between" two real snapshots gives smooth motion even
 * though updates arrive at only 20 Hz.
 * Pattern: Strategy (InterpolationPolicy, frontend.md) — Why: the blending rule
 * (linear now; dead-reckoning for vehicles later) is isolated here.
 */
export class SnapshotInterpolator {
  private samples: Sample[] = [];
  private interval = 0;

  constructor(private readonly keepMs = 1000) {}

  get size(): number {
    return this.samples.length;
  }

  /** Server timestamp (ms) of the newest sample, or −∞ when empty. */
  get latest(): number {
    return this.samples.at(-1)?.time ?? Number.NEGATIVE_INFINITY;
  }

  /** Smoothed gap between updates (ms): ~50 for nearby players, larger for ones the server updates less often. */
  get averageIntervalMs(): number {
    return this.interval;
  }

  /** The newest pose recorded, if any. */
  get latestPose(): Pose | undefined {
    return this.samples.at(-1)?.pose;
  }

  push(time: number, pose: Pose): void {
    const last = this.samples.at(-1);
    if (last && time <= last.time) return; // late or duplicate: ignore
    // Long silences (a stationary player) are not an update rate: ignore them.
    if (last && time - last.time <= MAX_INTERVAL_MS) {
      const gap = time - last.time;
      this.interval = this.interval === 0 ? gap : this.interval + (gap - this.interval) * 0.3;
    }
    this.samples.push({ time, pose });
    const cutoff = time - this.keepMs;
    while (this.samples.length > 2 && (this.samples[0]?.time ?? 0) < cutoff) this.samples.shift();
  }

  sample(time: number): SampledPose | undefined {
    const first = this.samples[0];
    const last = this.samples.at(-1);
    if (!first || !last) return undefined;
    if (time <= first.time) return { ...first.pose, speed: 0 };
    // Past the newest data: hold the last known pose rather than guessing.
    if (time >= last.time) return { ...last.pose, speed: 0 };

    let i = this.samples.length - 1;
    while (i > 0 && (this.samples[i - 1]?.time ?? 0) >= time) i--;
    const a = this.samples[i - 1] as Sample;
    const b = this.samples[i] as Sample;
    const span = b.time - a.time;
    const t = span > 0 ? (time - a.time) / span : 1;
    const lerp = (p: number, q: number) => p + (q - p) * t;
    return {
      x: lerp(a.pose.x, b.pose.x),
      y: lerp(a.pose.y, b.pose.y),
      z: lerp(a.pose.z, b.pose.z),
      yaw: lerpAngle(a.pose.yaw, b.pose.yaw, t),
      pitch: lerp(a.pose.pitch, b.pose.pitch),
      // Discrete state flips at the later snapshot's side of the midpoint.
      flags: t < 0.5 ? a.pose.flags : b.pose.flags,
      hp: t < 0.5 ? a.pose.hp : b.pose.hp,
      speed: span > 0 ? (Math.hypot(b.pose.x - a.pose.x, b.pose.z - a.pose.z) / span) * 1000 : 0,
    };
  }
}
