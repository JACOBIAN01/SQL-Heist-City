/** How the vault door moves, in seconds (art only: the server opens the door at once). */
export const VAULT_TIMING = {
  /** A cracked lock: the wheel turns once while that lock's bolts slide back. */
  crackSpin: 0.8,
  boltDelay: 0.2,
  boltSlide: 0.5,
  /** The last lock: the wheel spins twice, every bolt withdraws, then the door swings. */
  openSpin: 1.2,
  openTurns: 2,
  swingDelay: 1.0,
  swing: 2.6,
  /** How far the door swings open (radians, ~100°). */
  swingAngle: (100 * Math.PI) / 180,
} as const;

/** A moment the art should mark with particles. */
export interface VaultEffect {
  readonly kind: 'sparks' | 'dust';
  readonly at: number;
}

/** Where the door's moving parts are at one moment. */
export interface VaultPose {
  /** Wheel rotation, radians. */
  readonly wheel: number;
  /** For each bolt, 0 locked … 1 withdrawn. */
  readonly bolts: readonly number[];
  /** 0 shut … 1 swung fully open. */
  readonly swing: number;
}

const ease = (t: number) => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
};

interface Spin {
  readonly start: number;
  readonly duration: number;
  readonly turns: number;
}

/**
 * The vault door's story told in time: each cracked lock turns the wheel and
 * draws that lock's bolts; the last one spins the wheel, draws every bolt
 * and swings the door open. Fed the server's lock count; progress that was
 * already there when we first hear of the vault is shown as it stands, not
 * replayed, and a reset (new round) snaps the door shut.
 * Pure state over time, so it is tested without three.js.
 */
export class VaultDoorAnimation {
  private opened: number | undefined;
  private readonly boltStart: number[];
  private spins: Spin[] = [];
  private swingStart = Infinity;
  /** Wheel angle already reached by finished spins (so old spins can be dropped). */
  private wheelBase = 0;

  constructor(
    readonly locks: number,
    readonly boltCount = 12,
  ) {
    this.boltStart = Array.from({ length: Math.max(1, locks) }, () => Infinity);
  }

  /** The lock count changed (or was first heard). Returns the effects to show for it. */
  observe(opened: number, now: number): VaultEffect[] {
    const before = this.opened;
    this.opened = opened;
    if (before === undefined || opened < before) {
      // First news, or a new round: show the state as it is, no replay.
      this.spins = [];
      this.wheelBase = 0;
      this.boltStart.fill(Infinity);
      for (let k = 0; k < Math.min(opened, this.locks); k++) this.boltStart[k] = -Infinity;
      this.swingStart = opened >= this.locks ? -Infinity : Infinity;
      return [];
    }
    const effects: VaultEffect[] = [];
    for (let k = before; k < Math.min(opened, this.locks); k++) {
      const last = k + 1 >= this.locks;
      if (last) {
        this.spins.push({
          start: now,
          duration: VAULT_TIMING.openSpin,
          turns: VAULT_TIMING.openTurns,
        });
        for (let i = 0; i < this.boltStart.length; i++)
          this.boltStart[i] = Math.min(this.boltStart[i] ?? Infinity, now + VAULT_TIMING.boltDelay);
        this.swingStart = now + VAULT_TIMING.swingDelay;
        effects.push({ kind: 'sparks', at: now }, { kind: 'dust', at: this.swingStart });
      } else {
        this.spins.push({ start: now, duration: VAULT_TIMING.crackSpin, turns: 1 });
        this.boltStart[k] = now + VAULT_TIMING.boltDelay;
        effects.push({ kind: 'sparks', at: now });
      }
    }
    return effects;
  }

  /** Whether anything is still moving at `now` (the art can rest otherwise). */
  moving(now: number): boolean {
    return (
      this.spins.some((s) => now < s.start + s.duration) ||
      this.boltStart.some((t) => t > now - VAULT_TIMING.boltSlide && t !== Infinity) ||
      (now >= this.swingStart && now < this.swingStart + VAULT_TIMING.swing)
    );
  }

  pose(now: number): VaultPose {
    // Fold finished spins into the base angle.
    this.spins = this.spins.filter((s) => {
      if (now < s.start + s.duration) return true;
      this.wheelBase += s.turns * Math.PI * 2;
      return false;
    });
    let wheel = this.wheelBase;
    for (const s of this.spins) wheel += s.turns * Math.PI * 2 * ease((now - s.start) / s.duration);
    const bolts = Array.from({ length: this.boltCount }, (_, i) => {
      // Bolts are shared out round the door, one lock after another.
      const start = this.boltStart[i % this.boltStart.length] ?? Infinity;
      return start === -Infinity ? 1 : ease((now - start) / VAULT_TIMING.boltSlide);
    });
    const swing =
      this.swingStart === -Infinity ? 1 : ease((now - this.swingStart) / VAULT_TIMING.swing);
    return { wheel, bolts, swing };
  }
}
