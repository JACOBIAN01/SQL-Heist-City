export interface BodyPose {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Body height at that moment (crouching players are shorter). */
  readonly height: number;
}

interface Entry extends BodyPose {
  readonly tick: number;
}

/**
 * Short per-player history of where everyone was, so a shot can be judged
 * against the world the shooter actually saw. The shooter's screen shows other
 * players ~RTT/2 + interpolation delay in the past; without rewinding, you
 * would have to lead every target by your ping.
 */
export class LagCompensator {
  private readonly history = new Map<number, Entry[]>();

  /** @param capacityTicks how many ticks of history to keep per player */
  constructor(private readonly capacityTicks: number) {}

  record(tick: number, id: number, pose: BodyPose): void {
    let entries = this.history.get(id);
    if (!entries) {
      entries = [];
      this.history.set(id, entries);
    }
    entries.push({ tick, ...pose });
    while (entries.length > this.capacityTicks) entries.shift();
  }

  /** Forget a player (left, or teleported by a respawn: do not blend across the jump). */
  forget(id: number): void {
    this.history.delete(id);
  }

  /**
   * Where `id` was at `tick` (fractional ticks blend between records).
   * Before the oldest record → the oldest; after the newest → the newest.
   */
  poseAt(id: number, tick: number): BodyPose | undefined {
    const entries = this.history.get(id);
    const first = entries?.[0];
    const last = entries?.at(-1);
    if (!entries || !first || !last) return undefined;
    if (tick <= first.tick) return first;
    if (tick >= last.tick) return last;

    let i = entries.length - 1;
    while (i > 0 && (entries[i - 1]?.tick ?? 0) >= tick) i--;
    const a = entries[i - 1] as Entry;
    const b = entries[i] as Entry;
    const t = (tick - a.tick) / (b.tick - a.tick);
    return {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      z: a.z + (b.z - a.z) * t,
      height: t < 0.5 ? a.height : b.height,
    };
  }
}
