import { describe, expect, it } from 'vitest';
import { ShotRng } from './ShotRng';

const draw = (r: ShotRng, n = 5) => Array.from({ length: n }, () => r.next());

describe('ShotRng', () => {
  it('gives the same sequence for the same seed, in place', () => {
    const r = new ShotRng();
    r.reseed(1, 2, 3, 4);
    const first = draw(r);
    r.reseed(1, 2, 3, 4);
    expect(draw(r)).toEqual(first);
  });

  it('differs when any part of the seed differs', () => {
    const r = new ShotRng();
    const seq = (a: number, b: number, c: number, d: number) => {
      r.reseed(a, b, c, d);
      return draw(r);
    };
    const base = seq(1, 2, 3, 4);
    for (const other of [seq(9, 2, 3, 4), seq(1, 9, 3, 4), seq(1, 2, 9, 4), seq(1, 2, 3, 9)]) {
      expect(other).not.toEqual(base);
    }
  });

  it('stays in [0, 1) and is roughly uniform', () => {
    const r = new ShotRng();
    r.reseed(7, 7, 7, 7);
    const values = draw(r, 4000);
    expect(values.every((v) => v >= 0 && v < 1)).toBe(true);
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    expect(mean).toBeGreaterThan(0.45);
    expect(mean).toBeLessThan(0.55);
  });
});
