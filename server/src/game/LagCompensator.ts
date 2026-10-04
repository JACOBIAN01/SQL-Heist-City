export interface BodyPose {
  x: number;
  y: number;
  z: number;
  /** Body height at that moment (crouching players are shorter). */
  height: number;
}

/** Fixed-size history of one player: ticks and (x, y, z, height) in typed arrays, newest overwrites oldest. */
class Ring {
  readonly ticks: Int32Array;
  readonly data: Float64Array;
  /** Index of the next slot to write. */
  head = 0;
  count = 0;

  constructor(readonly capacity: number) {
    this.ticks = new Int32Array(capacity);
    this.data = new Float64Array(capacity * 4);
  }

  /** Slot holding the `age`-th newest entry (0 = newest). */
  slot(age: number): number {
    return (this.head - 1 - age + this.capacity * 2) % this.capacity;
  }
}

/**
 * Short per-player history of where everyone was, so a shot can be judged
 * against the world the shooter actually saw. The shooter's screen shows other
 * players ~RTT/2 + interpolation delay in the past; without rewinding, you
 * would have to lead every target by your ping.
 *
 * Recording happens for every player every tick, so history lives in ring
 * buffers of typed arrays: recording and lookup allocate nothing.
 * Pattern: Object Pool / ring buffer — Why: constant memory, no garbage per tick.
 */
export class LagCompensator {
  private readonly rings = new Map<number, Ring>();

  /** @param capacityTicks how many ticks of history to keep per player */
  constructor(private readonly capacityTicks: number) {}

  record(tick: number, id: number, x: number, y: number, z: number, height: number): void {
    let ring = this.rings.get(id);
    if (!ring) {
      ring = new Ring(this.capacityTicks);
      this.rings.set(id, ring);
    }
    const at = ring.head;
    ring.ticks[at] = tick;
    const base = at * 4;
    ring.data[base] = x;
    ring.data[base + 1] = y;
    ring.data[base + 2] = z;
    ring.data[base + 3] = height;
    ring.head = (at + 1) % ring.capacity;
    if (ring.count < ring.capacity) ring.count++;
  }

  /** Forget a player (left, or teleported by a respawn: do not blend across the jump). */
  forget(id: number): void {
    this.rings.delete(id);
  }

  /**
   * Fills `out` with where `id` was at `tick` (fractional ticks blend between
   * records) and returns true; false if there is no history. Before the oldest
   * record → the oldest; after the newest → the newest.
   */
  poseAt(id: number, tick: number, out: BodyPose): boolean {
    const ring = this.rings.get(id);
    if (!ring || ring.count === 0) return false;
    const newest = ring.slot(0);
    if (tick >= (ring.ticks[newest] as number)) return this.read(ring, newest, out);
    const oldest = ring.slot(ring.count - 1);
    if (tick <= (ring.ticks[oldest] as number)) return this.read(ring, oldest, out);

    // Walk back from the newest until we pass `tick`.
    let age = 0;
    while (age + 1 < ring.count && (ring.ticks[ring.slot(age + 1)] as number) >= tick) age++;
    const later = ring.slot(age);
    const earlier = ring.slot(age + 1);
    const t0 = ring.ticks[earlier] as number;
    const t1 = ring.ticks[later] as number;
    const f = (tick - t0) / (t1 - t0);
    const a = earlier * 4;
    const b = later * 4;
    const d = ring.data;
    out.x = (d[a] as number) + ((d[b] as number) - (d[a] as number)) * f;
    out.y = (d[a + 1] as number) + ((d[b + 1] as number) - (d[a + 1] as number)) * f;
    out.z = (d[a + 2] as number) + ((d[b + 2] as number) - (d[a + 2] as number)) * f;
    out.height = f < 0.5 ? (d[a + 3] as number) : (d[b + 3] as number);
    return true;
  }

  private read(ring: Ring, slot: number, out: BodyPose): boolean {
    const i = slot * 4;
    out.x = ring.data[i] as number;
    out.y = ring.data[i + 1] as number;
    out.z = ring.data[i + 2] as number;
    out.height = ring.data[i + 3] as number;
    return true;
  }
}
