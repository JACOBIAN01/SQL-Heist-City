/**
 * Deterministic random numbers. Everything random in the game (question
 * variants, generated tables, city layout, loot) goes through an Rng built
 * from a seed, so the same seed always reproduces the same result.
 */

// SOLID: D (Dependency Inversion) — Why: code that needs randomness takes an
// `Rng`, never calls Math.random. Tests pass a fixed seed; the server derives
// per-player seeds; nothing else has to change.
export interface Rng {
  /** Float in [0, 1). */
  next(): number;
  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number;
  /** True with probability p. */
  bool(p?: number): boolean;
  /** Uniform pick from a non-empty array. */
  pick<T>(items: readonly T[]): T;
  /** Pick using relative weights (same length as items). */
  weightedPick<T>(items: readonly T[], weights: readonly number[]): T;
  /** Fisher–Yates shuffle into a new array. */
  shuffle<T>(items: readonly T[]): T[];
  /**
   * Independent child stream. Lets two consumers (e.g. params vs table data)
   * draw numbers without one shifting the other's sequence when it changes.
   */
  fork(label: string): Rng;
}

/** SFC32 generator seeded via cyrb128: fast, small state, good statistical quality. */
export class SeededRng implements Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  constructor(private readonly seed: string) {
    [this.a, this.b, this.c, this.d] = cyrb128(seed);
    // Discard the first outputs; SFC32 needs a few rounds to mix weak seeds.
    for (let i = 0; i < 12; i++) this.next();
  }

  next(): number {
    this.a >>>= 0;
    this.b >>>= 0;
    this.c >>>= 0;
    this.d >>>= 0;
    let t = (this.a + this.b) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.d = (this.d + 1) | 0;
    t = (t + this.d) | 0;
    this.c = (this.c + t) | 0;
    return (t >>> 0) / 4294967296;
  }

  int(min: number, max: number): number {
    if (!Number.isInteger(min) || !Number.isInteger(max) || min > max) {
      throw new RangeError(`invalid int range [${min}, ${max}]`);
    }
    return min + Math.floor(this.next() * (max - min + 1));
  }

  bool(p = 0.5): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new RangeError('pick from empty array');
    return items[Math.floor(this.next() * items.length)] as T;
  }

  weightedPick<T>(items: readonly T[], weights: readonly number[]): T {
    if (items.length === 0 || items.length !== weights.length) {
      throw new RangeError('weightedPick needs one positive weight per item');
    }
    const total = weights.reduce((sum, w) => sum + w, 0);
    let roll = this.next() * total;
    for (let i = 0; i < items.length; i++) {
      roll -= weights[i] as number;
      if (roll < 0) return items[i] as T;
    }
    return items[items.length - 1] as T;
  }

  shuffle<T>(items: readonly T[]): T[] {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [out[i], out[j]] = [out[j] as T, out[i] as T];
    }
    return out;
  }

  fork(label: string): Rng {
    return new SeededRng(`${this.seed}/${label}`);
  }
}

/** Combines parts into one seed string, e.g. seedOf(matchSeed, playerId, 'heal', 3). */
export function seedOf(...parts: readonly (string | number)[]): string {
  return parts.map(String).join('|');
}

/** 128-bit string hash (public domain, bryc). */
function cyrb128(str: string): [number, number, number, number] {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}
