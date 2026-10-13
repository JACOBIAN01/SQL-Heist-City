import { describe, expect, it } from 'vitest';
import { DEFAULT_ANALYTICS_SETTINGS, analyticsSettingsSchema } from '../questions/analytics';
import { scoreItem, type ItemRecord } from './items';
import { addItem, axisScores, emptyTotals, mergeTotals, remediation } from './profile';

const S = DEFAULT_ANALYTICS_SETTINGS;
const item = (over: Partial<ItemRecord> = {}): ItemRecord => ({
  challengeId: 'c1',
  questionId: 1,
  questionVersion: 1,
  rewardKey: 'heal:small',
  tier: 2,
  rcsbe: 'S',
  bloom: 'apply',
  marks: 4,
  topics: ['join'],
  outcome: 'solved',
  runs: 1,
  submits: 1,
  wrongSubmits: 0,
  hintsPaid: 0,
  secondsOpen: 60,
  tutorial: false,
  issuedAt: 0,
  finishedAt: 60_000,
  ...over,
});

describe('scoreItem: each row of the earned/available table (docs/RCBSE.md §6)', () => {
  it('solved: full marks, less a share per paid hint, never below the floor', () => {
    expect(scoreItem(item(), S)).toEqual({ counted: true, available: 4, earned: 4 });
    expect(scoreItem(item({ hintsPaid: 1 }), S).earned).toBe(3);
    expect(scoreItem(item({ hintsPaid: 2 }), S).earned).toBe(2);
    expect(scoreItem(item({ hintsPaid: 9 }), S).earned).toBe(1); // floor: 25% of 4
  });

  it('solved after wrong answers still earns (the lockout was the price)', () => {
    expect(scoreItem(item({ wrongSubmits: 3, submits: 4 }), S).earned).toBe(4);
  });

  it('worked then expired or abandoned: counted, earns nothing', () => {
    for (const outcome of ['expired', 'abandoned', 'switched', 'left'] as const)
      expect(scoreItem(item({ outcome, submits: 2, wrongSubmits: 2 }), S), outcome).toEqual({
        counted: true,
        available: 4,
        earned: 0,
      });
    expect(scoreItem(item({ outcome: 'abandoned', runs: 1, submits: 0 }), S).counted).toBe(true);
  });

  it('opened and dropped at once with no Run or Submit: not counted; after a long look: counted', () => {
    const idle = { outcome: 'abandoned' as const, runs: 0, submits: 0, wrongSubmits: 0 };
    expect(scoreItem(item({ ...idle, secondsOpen: 5 }), S).counted).toBe(false);
    expect(scoreItem(item({ ...idle, secondsOpen: 19.9 }), S).counted).toBe(false);
    expect(scoreItem(item({ ...idle, secondsOpen: 20 }), S)).toEqual({
      counted: true,
      available: 4,
      earned: 0,
    });
    expect(scoreItem(item({ ...idle, outcome: 'expired', secondsOpen: 300 }), S).counted).toBe(
      true,
    );
  });

  it('death: nothing before a graded attempt, a worked failure after one', () => {
    expect(scoreItem(item({ outcome: 'died', runs: 3, submits: 0 }), S).counted).toBe(false);
    expect(scoreItem(item({ outcome: 'died', runs: 0, submits: 1, wrongSubmits: 1 }), S)).toEqual({
      counted: true,
      available: 4,
      earned: 0,
    });
  });

  it('the tutorial never counts', () => {
    expect(scoreItem(item({ tutorial: true }), S).counted).toBe(false);
  });

  it('follows the settings, not constants', () => {
    const strict = analyticsSettingsSchema.parse({
      hintPenalty: 0.5,
      minEarnedShare: 0,
      abandonSeconds: 60,
    });
    expect(scoreItem(item({ hintsPaid: 2 }), strict).earned).toBe(0);
    expect(
      scoreItem(item({ outcome: 'abandoned', runs: 0, submits: 0, secondsOpen: 40 }), strict)
        .counted,
    ).toBe(false);
  });
});

describe('profile totals', () => {
  it('pool marks per dimension and per Bloom level, ignoring items that do not count', () => {
    let t = emptyTotals();
    t = addItem(t, item({ marks: 4 }), S);
    t = addItem(t, item({ marks: 2, outcome: 'expired', submits: 1 }), S);
    t = addItem(t, item({ marks: 5, rcsbe: 'C', bloom: 'understand' }), S);
    t = addItem(t, item({ tutorial: true }), S);
    expect(t.rcsbe.S).toEqual({ earned: 4, available: 6, items: 2 });
    expect(t.rcsbe.C).toEqual({ earned: 5, available: 5, items: 1 });
    expect(t.bloom.apply.items).toBe(2);
    expect(t.rcsbe.R).toEqual({ earned: 0, available: 0, items: 0 });
  });

  it('adding two sets equals adding all the items to one (so live totals match a rebuild)', () => {
    const items = [
      item({ marks: 1 }),
      item({ marks: 3, hintsPaid: 1 }),
      item({ marks: 5, outcome: 'expired', runs: 2 }),
    ];
    const all = items.reduce((t, i) => addItem(t, i, S), emptyTotals());
    const left = addItem(emptyTotals(), items[0] as ItemRecord, S);
    const right = items.slice(1).reduce((t, i) => addItem(t, i, S), emptyTotals());
    expect(mergeTotals(left, right)).toEqual(all);
  });

  it('pools marks rather than averaging percentages', () => {
    // 1/1 on a 1-mark item and 0/9 on a 9-mark item: pooled 10%, not the 50% average of 100% and 0%.
    let t = addItem(emptyTotals(), item({ marks: 1 }), S);
    t = addItem(t, item({ marks: 9, outcome: 'expired', submits: 1 }), S);
    t = addItem(t, item({ marks: 1 }), S);
    const s = axisScores(t, 'rcsbe', S).find((a) => a.dimension === 'S');
    expect(s).toMatchObject({ earned: 2, available: 11, items: 3, enough: true, score: 18.2 });
  });
});

describe('axisScores and remediation', () => {
  const totals = (spec: Record<string, [number, number, number]>) => {
    let t = emptyTotals();
    for (const [dim, [earned, available, items]] of Object.entries(spec)) {
      t = mergeTotals(t, {
        ...emptyTotals(),
        rcsbe: { ...emptyTotals().rcsbe, [dim]: { earned, available, items } },
      });
    }
    return t;
  };

  it('says "not enough data" (null), never 0, when evidence is thin', () => {
    const scores = axisScores(totals({ S: [0, 12, 4], C: [0, 2, 1], R: [0, 6, 2] }), 'rcsbe', S);
    const by = Object.fromEntries(scores.map((s) => [s.dimension, s]));
    expect(by.S?.score).toBe(0);
    expect(by.C).toMatchObject({ score: null, enough: false });
    expect(by.R?.score).toBeNull(); // 2 items < 3
    expect(by.B).toMatchObject({ score: null, items: 0 });
  });

  it('picks the lowest axis that has enough evidence, ties to the earlier axis', () => {
    const scores = axisScores(
      totals({ S: [6, 12, 4], C: [3, 10, 3], R: [3, 10, 3], E: [1, 20, 5] }),
      'rcsbe',
      S,
    );
    expect(remediation(scores)?.dimension).toBe('E'); // 5%
    const tie = axisScores(totals({ S: [5, 10, 4], C: [5, 10, 4] }), 'rcsbe', S);
    expect(remediation(tie)?.dimension).toBe('C');
  });

  it('gives no signal with no evidence, or with one item', () => {
    expect(remediation(axisScores(emptyTotals(), 'rcsbe', S))).toBeUndefined();
    const one = axisScores(totals({ S: [1, 3, 1] }), 'rcsbe', S);
    expect(remediation(one)).toBeUndefined();
  });

  it('scores the Bloom lens the same way', () => {
    let t = emptyTotals();
    for (let i = 0; i < 3; i++)
      t = addItem(t, item({ marks: 3, bloom: 'analyze', outcome: 'expired', submits: 1 }), S);
    t = addItem(t, item({ marks: 5 }), S);
    t = addItem(t, item({ marks: 5 }), S);
    t = addItem(t, item({ marks: 5 }), S);
    const scores = axisScores(t, 'bloom', S);
    expect(scores).toHaveLength(6);
    expect(remediation(scores)?.dimension).toBe('analyze');
  });
});
