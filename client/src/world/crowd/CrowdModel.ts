import type { AtmosphereSettings, CityLayout, Rect, Rng } from '@heist/shared';
import { SeededRng, seedOf } from '@heist/shared';

type CrowdSettings = AtmosphereSettings['crowd'];

/** A closed path around a block's sidewalk, as four corners in order. */
export interface Ring {
  readonly corners: readonly { readonly x: number; readonly z: number }[];
  readonly length: number;
}

/** The sidewalk ring of a rectangle: its outline pulled in by `inset`, walked clockwise from above. */
export function ringOf(rect: Rect, inset: number): Ring {
  const a = { x: rect.minX + inset, z: rect.minZ + inset };
  const b = { x: rect.maxX - inset, z: rect.minZ + inset };
  const c = { x: rect.maxX - inset, z: rect.maxZ - inset };
  const d = { x: rect.minX + inset, z: rect.maxZ - inset };
  const corners = [a, b, c, d];
  const length = corners.reduce((sum, p, i) => {
    const q = corners[(i + 1) % 4] as { x: number; z: number };
    return sum + Math.hypot(q.x - p.x, q.z - p.z);
  }, 0);
  return { corners, length };
}

/** Where `s` metres along a ring is, wrapped round, and which way a walker facing forward looks. */
export function pointOn(ring: Ring, s: number): { x: number; z: number; heading: number } {
  let at = ((s % ring.length) + ring.length) % ring.length;
  for (let i = 0; i < 4; i++) {
    const p = ring.corners[i] as { x: number; z: number };
    const q = ring.corners[(i + 1) % 4] as { x: number; z: number };
    const side = Math.hypot(q.x - p.x, q.z - p.z);
    if (at <= side || i === 3) {
      const t = side === 0 ? 0 : at / side;
      return {
        x: p.x + (q.x - p.x) * t,
        z: p.z + (q.z - p.z) * t,
        heading: Math.atan2(q.x - p.x, q.z - p.z),
      };
    }
    at -= side;
  }
  return { x: 0, z: 0, heading: 0 };
}

interface Walker {
  readonly ring: number;
  s: number;
  /** +1 forward round the ring, −1 back. */
  dir: 1 | -1;
  readonly pace: number;
  readonly tint: number;
  fleeUntil: number;
  fleeDir: 1 | -1;
}

/** One person as the renderer needs them. */
export interface PedPose {
  readonly id: number;
  readonly x: number;
  readonly z: number;
  /** Radians, 0 facing +z (the way a body faces at yaw 0 is −z, so the renderer turns it). */
  readonly heading: number;
  readonly moving: boolean;
  readonly fleeing: boolean;
  readonly tint: number;
  /** A per-person offset so a crowd does not step in time. */
  readonly phase: number;
}

const TINTS = [
  0xc0392b, 0x2980b9, 0x27ae60, 0xd4a017, 0x8e44ad, 0x16a085, 0xecf0f1, 0x7f8c8d, 0xe67e22,
  0x34495e,
];

/**
 * The street crowd (Phase 29.1): people strolling round the sidewalks of every block, who run
 * from gunfire and then go back to strolling. It is scenery with a little life: a pure model with
 * no drawing, seeded from the city so everyone sees much the same crowd, and never part of the
 * game state (the server knows nothing of it, and nobody can be hurt).
 */
export class CrowdModel {
  private readonly rings: Ring[];
  private readonly walkers: Walker[] = [];
  private time = 0;

  constructor(
    city: CityLayout,
    private readonly settings: () => CrowdSettings,
    seed = 'crowd',
  ) {
    const inset = city.settings.sidewalkWidth / 2;
    this.rings = city.blocks.map((b) => ringOf(b.outer, inset));
    this.populate(new SeededRng(seedOf('crowd', seed)), settings().count);
  }

  get size(): number {
    return this.walkers.length;
  }

  /** People are spread over the blocks in proportion to the length of their sidewalks. */
  private populate(rng: Rng, count: number): void {
    const total = this.rings.reduce((sum, r) => sum + r.length, 0);
    if (total === 0) return;
    for (let n = 0; n < count; n++) {
      let pick = rng.next() * total;
      let ring = 0;
      for (let i = 0; i < this.rings.length; i++) {
        pick -= (this.rings[i] as Ring).length;
        if (pick <= 0) {
          ring = i;
          break;
        }
      }
      this.walkers.push({
        ring,
        s: rng.next() * (this.rings[ring] as Ring).length,
        dir: rng.bool(0.5) ? 1 : -1,
        pace: 0.8 + rng.next() * 0.45,
        tint: TINTS[rng.int(0, TINTS.length - 1)] as number,
        fleeUntil: 0,
        fleeDir: 1,
      });
    }
  }

  /** Advances everyone by `dt` seconds. */
  update(dt: number): void {
    this.time += dt;
    const { walkSpeed, fleeSpeed } = this.settings();
    for (const w of this.walkers) {
      const fleeing = this.time < w.fleeUntil;
      if (fleeing) w.dir = w.fleeDir;
      w.s += w.dir * (fleeing ? fleeSpeed : walkSpeed * w.pace) * dt;
    }
  }

  /** A shot went off at (x, z): everyone who can hear it runs, away from it, for a while. */
  alarm(x: number, z: number): void {
    const { hearRadius, fleeSeconds } = this.settings();
    this.walkers.forEach((w, i) => {
      const here = this.position(w);
      if (Math.hypot(here.x - x, here.z - z) > hearRadius) return;
      w.fleeUntil = this.time + fleeSeconds;
      // Whichever way round the block takes them further from the sound.
      const ring = this.rings[w.ring] as Ring;
      const ahead = pointOn(ring, w.s + 2);
      const behind = pointOn(ring, w.s - 2);
      w.fleeDir =
        Math.hypot(ahead.x - x, ahead.z - z) >= Math.hypot(behind.x - x, behind.z - z) ? 1 : -1;
      void i;
    });
  }

  private position(w: Walker): { x: number; z: number; heading: number } {
    return pointOn(this.rings[w.ring] as Ring, w.s);
  }

  /** The people within `radius` metres of the viewer. */
  *near(viewer: { x: number; z: number }, radius: number): IterableIterator<PedPose> {
    for (let id = 0; id < this.walkers.length; id++) {
      const w = this.walkers[id] as Walker;
      const p = this.position(w);
      if (Math.abs(p.x - viewer.x) > radius || Math.abs(p.z - viewer.z) > radius) continue;
      if (Math.hypot(p.x - viewer.x, p.z - viewer.z) > radius) continue;
      yield {
        id,
        x: p.x,
        z: p.z,
        // Walking backwards round the ring means facing the other way.
        heading: w.dir === 1 ? p.heading : p.heading + Math.PI,
        moving: true,
        fleeing: this.time < w.fleeUntil,
        tint: w.tint,
        phase: (id * 0.37) % (Math.PI * 2),
      };
    }
  }
}
