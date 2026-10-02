import { describe, expect, it } from 'vitest';
import { SeededRng, seedOf } from './Rng';

const draw = (seed: string, n = 20) => {
  const rng = new SeededRng(seed);
  return Array.from({ length: n }, () => rng.next());
};

describe('SeededRng', () => {
  it('is deterministic for the same seed', () => {
    expect(draw('match-1')).toEqual(draw('match-1'));
  });

  it('differs for different seeds, even similar ones', () => {
    expect(draw('player-1')).not.toEqual(draw('player-2'));
  });

  it('next() stays in [0, 1)', () => {
    for (const x of draw('range', 10_000)) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });

  it('int() covers the inclusive range roughly uniformly', () => {
    const rng = new SeededRng('dice');
    const counts = new Map<number, number>();
    for (let i = 0; i < 60_000; i++) {
      const face = rng.int(1, 6);
      counts.set(face, (counts.get(face) ?? 0) + 1);
    }
    expect([...counts.keys()].sort()).toEqual([1, 2, 3, 4, 5, 6]);
    for (const c of counts.values()) expect(c).toBeGreaterThan(9_000);
    for (const c of counts.values()) expect(c).toBeLessThan(11_000);
  });

  it('int() rejects invalid ranges', () => {
    expect(() => new SeededRng('x').int(5, 1)).toThrow(RangeError);
    expect(() => new SeededRng('x').int(0.5, 2)).toThrow(RangeError);
  });

  it('weightedPick() respects weights', () => {
    const rng = new SeededRng('weights');
    let heavy = 0;
    for (let i = 0; i < 10_000; i++) if (rng.weightedPick(['a', 'b'], [9, 1]) === 'a') heavy++;
    expect(heavy / 10_000).toBeGreaterThan(0.87);
    expect(heavy / 10_000).toBeLessThan(0.93);
  });

  it('shuffle() is a deterministic permutation', () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    const a = new SeededRng('s').shuffle(items);
    expect(a).toEqual(new SeededRng('s').shuffle(items));
    expect([...a].sort()).toEqual(items);
    expect(items).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('fork() streams are independent of how much the parent drew', () => {
    const a = new SeededRng('root');
    const b = new SeededRng('root');
    b.next();
    b.next();
    expect(a.fork('data').next()).toBe(b.fork('data').next());
    expect(a.fork('data').next()).not.toBe(a.fork('params').next());
  });

  it('pick() throws on empty input', () => {
    expect(() => new SeededRng('x').pick([])).toThrow(RangeError);
  });
});

describe('seedOf', () => {
  it('joins parts unambiguously enough for seeds', () => {
    expect(seedOf('m1', 7, 'heal', 2)).toBe('m1|7|heal|2');
  });
});
