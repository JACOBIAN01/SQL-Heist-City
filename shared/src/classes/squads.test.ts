import { describe, expect, it } from 'vitest';
import { assignmentProblems, balanceSquads, squadSizes } from './squads';

const students = (scores: (number | null)[]) => scores.map((score, i) => ({ id: i + 1, score }));
const sizes = (a: Record<number, number>) =>
  [...squadSizes(a)].sort((x, y) => x[0] - y[0]).map(([, n]) => n);
const total = (a: Record<number, number>, by: Map<number, number>, squad: number) =>
  Object.entries(a)
    .filter(([, s]) => s === squad)
    .reduce((sum, [id]) => sum + (by.get(Number(id)) ?? 0), 0);

describe('balancing squads by mastery', () => {
  it('uses the fewest squads that fit, sizes differing by at most one', () => {
    const a = balanceSquads(students(Array(10).fill(50)), 4, 10);
    expect(Object.keys(a)).toHaveLength(10);
    expect(sizes(a)).toEqual([3, 3, 4]); // three squads for ten students (the last squad has the extra)
    const exact = balanceSquads(students(Array(8).fill(50)), 4, 10);
    expect(sizes(exact)).toEqual([4, 4]);
  });

  it('deals strong and weak students across the squads, so none is stacked', () => {
    const scores = [95, 90, 85, 80, 40, 35, 30, 25];
    const a = balanceSquads(students(scores), 4, 10);
    const byId = new Map(students(scores).map((s) => [s.id, s.score ?? 0]));
    const sums = [1, 2].map((q) => total(a, byId, q));
    // A snake keeps the squads within a few points of each other: 95+80+35+30 = 240 against 90+85+40+25 = 240.
    expect(Math.abs((sums[0] ?? 0) - (sums[1] ?? 0))).toBeLessThanOrEqual(10);
    expect(a[1]).not.toBe(a[2]); // the top two are split up
  });

  it('treats an unknown score as average, and is the same every time', () => {
    const a = balanceSquads(students([90, null, 10, null, 50, null]), 3, 10);
    expect(a).toEqual(balanceSquads(students([90, null, 10, null, 50, null]), 3, 10));
    expect(sizes(a)).toEqual([3, 3]);
  });

  it('never makes more squads than allowed, and copes with no students or one', () => {
    expect(balanceSquads([], 4, 3)).toEqual({});
    const capped = balanceSquads(students(Array(30).fill(50)), 3, 4);
    expect(Math.max(...Object.values(capped))).toBe(4);
    expect(balanceSquads(students([70]), 4, 3)).toEqual({ 1: 1 });
  });
});

describe('checking a list', () => {
  it('finds a squad that is too big or out of range', () => {
    expect(assignmentProblems({ 1: 1, 2: 1, 3: 2 }, 3, 5)).toEqual([]);
    expect(assignmentProblems({ 1: 1, 2: 1, 3: 1, 4: 1 }, 3, 5)).toEqual([
      'squad 1 has 4 students; the most is 3',
    ]);
    expect(assignmentProblems({ 1: 9 }, 3, 5)).toEqual(['squad 9 is not one of the 5 squads']);
    expect(assignmentProblems({ 1: 0 }, 3, 5)).toHaveLength(1);
  });
});
