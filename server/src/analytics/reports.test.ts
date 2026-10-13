import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ANALYTICS_SETTINGS as S,
  addItem,
  axisScores,
  emptyTotals,
  type ItemRecord,
  type ProfileTotals,
} from '@heist/shared';
import type { StoredItem } from './AttemptStore';
import {
  classSpread,
  itemAnalysis,
  itemsCsv,
  poolTotals,
  profilesCsv,
  safeCell,
  topicMastery,
  weakestFirst,
  weakestTopics,
} from './reports';

let n = 0;
const item = (over: Partial<StoredItem> = {}): StoredItem => ({
  challengeId: `c${++n}`,
  accountId: 1,
  classId: 1,
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
  secondsOpen: 30,
  tutorial: false,
  issuedAt: 0,
  finishedAt: 1,
  counted: true,
  available: 4,
  earned: 4,
  ...over,
});
const failed = (over: Partial<StoredItem> = {}) =>
  item({ outcome: 'expired', earned: 0, wrongSubmits: 1, ...over });

describe('topicMastery and weakestTopics (15.16)', () => {
  it('pools marks per topic, counting a multi-topic question toward each, and ignores uncounted items', () => {
    const m = topicMastery(
      [
        item({ topics: ['join', 'group'] }),
        failed({ topics: ['join'] }),
        item({ topics: ['group'] }),
        item({ topics: ['window'], counted: false }),
        item({ topics: ['group'] }),
      ],
      S,
    );
    const by = Object.fromEntries(m.map((t) => [t.topic, t]));
    expect(by.join).toMatchObject({ items: 2, solved: 1, earned: 4, available: 8, score: null }); // 2 < 3 items
    expect(by.group).toMatchObject({ items: 3, earned: 12, available: 12, score: 100 });
    expect(by.window).toBeUndefined();
  });

  it('names the weakest topics that have enough evidence, lowest first', () => {
    const items = [
      ...Array.from({ length: 3 }, () => failed({ topics: ['cte'] })),
      ...Array.from({ length: 3 }, () => item({ topics: ['where'] })),
      ...Array.from({ length: 3 }, (_, i) => (i === 0 ? item : failed)({ topics: ['join'] })),
      failed({ topics: ['rare'] }),
    ];
    expect(weakestTopics(topicMastery(items, S), 2).map((t) => t.topic)).toEqual(['cte', 'join']);
  });
});

describe('classSpread, poolTotals and weakestFirst (15.11, 15.13)', () => {
  const totalsOf = (...rows: Partial<ItemRecord>[]): ProfileTotals =>
    rows.reduce<ProfileTotals>(
      (t, r) =>
        addItem(
          t,
          {
            challengeId: 'x',
            questionId: 1,
            questionVersion: 1,
            rewardKey: 'x',
            tier: 1,
            rcsbe: 'S',
            bloom: 'apply',
            marks: 3,
            topics: [],
            outcome: 'solved',
            runs: 1,
            submits: 1,
            wrongSubmits: 0,
            hintsPaid: 0,
            secondsOpen: 9,
            tutorial: false,
            issuedAt: 0,
            finishedAt: 1,
            ...r,
          },
          S,
        ),
      emptyTotals(),
    );
  const strong = totalsOf({}, {}, {});
  const weak = totalsOf(
    { outcome: 'expired', submits: 1 },
    { outcome: 'expired', submits: 1 },
    { outcome: 'expired', submits: 1 },
  );
  const middle = totalsOf({}, {}, { outcome: 'expired', submits: 1 });

  it('pools marks across students rather than averaging their percentages', () => {
    const pooled = poolTotals([strong, weak, middle]);
    expect(pooled.rcsbe.S).toEqual({ earned: 15, available: 27, items: 9 });
  });

  it('reports the spread per axis over students with enough evidence', () => {
    const scores = (t: ProfileTotals) => ({ scores: axisScores(t, 'rcsbe', S) });
    const spread = classSpread(
      [scores(strong), scores(weak), scores(middle)],
      ['R', 'C', 'S', 'B', 'E'],
    );
    const s = spread[2];
    expect(s).toMatchObject({ dimension: 'S', students: 3, min: 0, median: 66.7, max: 100 });
    expect(spread[0]).toMatchObject({ students: 0, min: null, median: null });
  });

  it('sorts students weakest first, with those without evidence last', () => {
    const rows = [
      { name: 'strong', scores: axisScores(strong, 'rcsbe', S) },
      { name: 'none', scores: axisScores(emptyTotals(), 'rcsbe', S) },
      { name: 'weak', scores: axisScores(weak, 'rcsbe', S) },
    ];
    expect(weakestFirst(rows).map((r) => r.name)).toEqual(['weak', 'strong', 'none']);
  });
});

describe('itemAnalysis (15.14)', () => {
  /** 9 students: students 1–3 strong, 7–9 weak, answering question 10 and a baseline question 20. */
  const build = (solve: (student: number) => boolean) => {
    const items: StoredItem[] = [];
    for (let s = 1; s <= 9; s++) {
      const strong = s <= 3;
      items.push(
        strong ? item({ accountId: s, questionId: 20 }) : failed({ accountId: s, questionId: 20 }),
      );
      items.push(
        solve(s)
          ? item({ accountId: s, questionId: 10, secondsOpen: 40 })
          : failed({ accountId: s, questionId: 10, secondsOpen: 90 }),
      );
    }
    return items;
  };
  const q10 = (items: StoredItem[]) =>
    itemAnalysis(items).find((a) => a.questionId === 10) as ReturnType<typeof itemAnalysis>[number];

  it('measures solve rate, wrong rate and the median time of those who solved it', () => {
    const a = q10(build((s) => s <= 5));
    expect(a).toMatchObject({
      attempts: 9,
      students: 9,
      solveRate: 0.56,
      wrongRate: 0.44,
      medianSeconds: 40,
    });
  });

  it('shows how well a question separates strong from weak students', () => {
    expect(q10(build((s) => s <= 3)).discrimination).toBe(1); // only the strong solve it
    expect(q10(build((s) => s % 2 === 1)).discrimination).toBeLessThan(0.5); // luck, not skill
    expect(q10(build((s) => s === 1 || s === 4 || s === 8)).flags).toContain('weak_separation');
  });

  it('flags questions that are too hard, too easy, slow, or have too few attempts', () => {
    expect(q10(build(() => false)).flags).toContain('too_hard');
    expect(q10(build(() => true)).flags).toContain('too_easy');
    const slow = build((s) => s <= 5).map((i) =>
      i.questionId === 10 ? { ...i, secondsOpen: 200 } : i,
    );
    expect(q10(slow).flags).toContain('slow');
    expect(itemAnalysis([item({ questionId: 5 })])[0]?.flags).toEqual(['few_attempts']);
  });

  it('ignores items that did not count and unsigned players', () => {
    const items = [
      item({ counted: false }),
      item({ accountId: undefined } as unknown as Partial<StoredItem>),
    ];
    expect(itemAnalysis(items)).toEqual([]);
  });
});

describe('CSV export (15.15)', () => {
  it('writes one row per student and axis, with scores blank where evidence is thin', () => {
    const t = [1, 2, 3].reduce<ProfileTotals>(
      (acc) =>
        addItem(
          acc,
          {
            challengeId: 'x',
            questionId: 1,
            questionVersion: 1,
            rewardKey: 'x',
            tier: 1,
            rcsbe: 'S',
            bloom: 'apply',
            marks: 3,
            topics: [],
            outcome: 'solved',
            runs: 1,
            submits: 1,
            wrongSubmits: 0,
            hintsPaid: 0,
            secondsOpen: 9,
            tutorial: false,
            issuedAt: 0,
            finishedAt: 1,
          },
          S,
        ),
      emptyTotals(),
    );
    const csv = profilesCsv('9B', [{ studentId: 7, name: 'Ana', totals: t }], S);
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe(
      'class,student_id,student,lens,dimension,marks_earned,marks_available,items,score_percent,enough_evidence',
    );
    expect(lines).toHaveLength(1 + 5 + 6);
    expect(lines).toContain('9B,7,Ana,rcsbe,S,9,9,3,100,yes');
    expect(lines).toContain('9B,7,Ana,rcsbe,R,0,0,0,,no');
  });

  it('defuses spreadsheet formulas and quotes awkward cells', () => {
    expect(safeCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(safeCell('+1')).toBe("'+1");
    expect(safeCell('Smith, Ann')).toBe('"Smith, Ann"');
    expect(safeCell('plain')).toBe('plain');
    const csv = profilesCsv('=bad', [{ studentId: 1, name: '@evil', totals: emptyTotals() }], S);
    expect(csv).not.toMatch(/(^|,)[=@]/m);
  });

  it('writes the question table', () => {
    const csv = itemsCsv(
      itemAnalysis(Array.from({ length: 6 }, (_, i) => item({ accountId: i + 1 }))),
    );
    expect(csv.split('\n')[0]).toContain('solve_rate');
    expect(csv.split('\n')[1]).toMatch(/^1,S,2,6,6,1,0,30,/);
  });
});
