/**
 * Tiny reseedable generator for bullet spread (mulberry32). A fresh string-seeded
 * generator per shot would allocate; this one is reseeded from four integers in
 * place, and the same (match, tick, player, sequence) always gives the same spread.
 */
export class ShotRng {
  private state = 0;

  reseed(a: number, b: number, c: number, d: number): void {
    this.state = mix(mix(mix(mix(0x9e3779b9, a), b), c), d) >>> 0;
  }

  /** Uniform in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
}

function mix(h: number, v: number): number {
  h = Math.imul(h ^ (v | 0), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  return h ^ (h >>> 16);
}
