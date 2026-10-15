import { afterAll, describe, expect, it } from 'vitest';
import { classInputSchema, type ItemRecord } from '@heist/shared';
import { PgClassRepository } from '../classes/ClassRepository';
import { TEST_DATABASE_URL, freshPg } from '../pg/testing';
import { PgPlayerRepository } from '../players/PlayerRepository';
import { BriefSink, InMemoryBriefStore, PgBriefStore, type BriefStore } from './BriefStore';

const drops: (() => Promise<void>)[] = [];
afterAll(() => Promise.all(drops.map((d) => d())));

interface Made {
  briefs: BriefStore;
  newClass: () => Promise<number>;
  newPlayer: (sub: string) => Promise<number>;
}

const implementations: [string, () => Promise<Made>][] = [
  [
    'in memory',
    async () => {
      let n = 0;
      return {
        briefs: new InMemoryBriefStore(),
        newClass: async () => ++n,
        newPlayer: async () => ++n,
      };
    },
  ],
  ...(TEST_DATABASE_URL
    ? [
        [
          'PostgreSQL',
          async () => {
            const { db, drop } = await freshPg();
            drops.push(drop);
            const classes = new PgClassRepository(db);
            const players = new PgPlayerRepository(db);
            return {
              briefs: new PgBriefStore(db),
              newClass: async () =>
                (await classes.create(classInputSchema.parse({ name: 'C' }), null)).id,
              newPlayer: async (sub: string) =>
                (
                  await players.upsertFromGoogle({
                    sub,
                    email: `${sub}@x.test`,
                    name: sub,
                    domain: null,
                  })
                ).id,
            };
          },
        ] as [string, () => Promise<Made>],
      ]
    : []),
];

let n = 0;
const brief = (over: Partial<ItemRecord>): ItemRecord => ({
  challengeId: `b${++n}`,
  questionId: 9,
  questionVersion: 2,
  rewardKey: 'brief:plan',
  tier: 3,
  rcsbe: 'B',
  bloom: 'create',
  marks: 6,
  topics: ['select'],
  outcome: 'submitted',
  runs: 2,
  submits: 1,
  wrongSubmits: 0,
  hintsPaid: 0,
  secondsOpen: 300,
  tutorial: false,
  issuedAt: 1_000,
  finishedAt: 2_000 + n,
  review: { title: 'Plan', story: 'Plan the next heist.', modelSql: '' },
  brief: {
    text: 'Goal: find the richest branch.',
    sql: 'SELECT branch FROM accounts',
    rubric: [
      { criterion: 'Goal', marks: 2 },
      { criterion: 'Check', marks: 4 },
    ],
  },
  ...over,
});

describe.each(implementations)('BriefStore (%s)', (_name, make) => {
  it('saves handed-in briefs once, lists them by class and status, and marks them', async () => {
    const { briefs, newClass, newPlayer } = await make();
    const [c1, c2] = [await newClass(), await newClass()];
    const ana = await newPlayer('ana');
    const a = brief({ accountId: ana, classId: c1, round: 2 });
    await briefs.add(a);
    await briefs.add(a);
    await briefs.add(brief({ accountId: ana, classId: c2 }));
    const { brief: _none, ...plain } = brief({ outcome: 'solved' });
    await briefs.add(plain);
    expect(await briefs.list({ classIds: [c1] })).toHaveLength(1);
    const got = await briefs.get(a.challengeId);
    expect(got).toMatchObject({
      playerId: ana,
      classId: c1,
      round: 2,
      title: 'Plan',
      itemMarks: 6,
      text: 'Goal: find the richest branch.',
      rubric: [
        { criterion: 'Goal', marks: 2 },
        { criterion: 'Check', marks: 4 },
      ],
      marks: null,
    });

    const result = await briefs.mark(a.challengeId, [2, 3], 'Good goal.', 't@school.test', 5_000);
    expect(result?.before.marks).toBeNull();
    expect(result?.after).toMatchObject({ marks: [2, 3], feedback: 'Good goal.', markedAt: 5_000 });
    expect(await briefs.list({ classIds: [c1], status: 'unmarked' })).toHaveLength(0);
    expect(await briefs.list({ classIds: [c1], status: 'marked' })).toHaveLength(1);
    expect(await briefs.list({ classIds: [c1, c2], status: 'all' })).toHaveLength(2);
    expect((await briefs.mark(a.challengeId, [1, 1], null, 't', 6_000))?.before.marks).toEqual([
      2, 3,
    ]);
    expect(await briefs.mark('nope', [1], null, 't', 1)).toBeNull();
    expect(await briefs.ofPlayer(ana)).toHaveLength(2);
  });

  it('is fed by the sink as briefs are handed in', async () => {
    const { briefs } = await make();
    const sink = new BriefSink(briefs);
    const b = brief({});
    sink.item({ ...b, outcome: 'abandoned' }, {});
    sink.item(b, {});
    await new Promise((r) => setTimeout(r, 50));
    expect((await briefs.list()).map((x) => x.id)).toEqual([b.challengeId]);
  });
});
