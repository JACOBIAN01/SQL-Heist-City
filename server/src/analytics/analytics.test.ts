import { afterAll, describe, expect, it } from 'vitest';
import {
  DEFAULT_ANALYTICS_SETTINGS as S,
  analyticsSettingsSchema,
  addItem,
  axisScores,
  classInputSchema,
  emptyTotals,
  type ItemRecord,
  type ProfileMessage,
  type ProfileTotals,
} from '@heist/shared';
import { PgClassRepository } from '../classes/ClassRepository';
import { TEST_DATABASE_URL, freshPg } from '../pg/testing';
import { PgPlayerRepository } from '../players/PlayerRepository';
import type { AttemptEvent } from './AttemptSink';
import {
  InMemoryAttemptStore,
  InMemoryProfileStore,
  PgAttemptStore,
  PgProfileStore,
  type AttemptStore,
  type ProfileStore,
} from './AttemptStore';
import { RetentionJob } from './RetentionJob';
import { BatchingRecorder, ProfileAggregator, scopeView } from './ProfileAggregator';

const drops: (() => Promise<void>)[] = [];
afterAll(() => Promise.all(drops.map((d) => d())));

const item = (over: Partial<ItemRecord> = {}): ItemRecord => ({
  challengeId: `c${Math.random()}`,
  accountId: 1,
  classId: 1,
  round: 1,
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
  issuedAt: 1_000,
  finishedAt: 31_000,
  ...over,
});

interface Made {
  attempts: AttemptStore;
  profiles: ProfileStore;
  /** An account and a class that exist (PostgreSQL needs real rows). */
  ids: () => Promise<{ account: number; classId: number }>;
}

const implementations: [string, () => Promise<Made>][] = [
  [
    'in memory',
    async () => ({
      attempts: new InMemoryAttemptStore(),
      profiles: new InMemoryProfileStore(),
      ids: async () => ({ account: 1, classId: 1 }),
    }),
  ],
  ...(TEST_DATABASE_URL
    ? [
        [
          'PostgreSQL',
          async () => {
            const { db, drop } = await freshPg();
            drops.push(drop);
            const players = new PgPlayerRepository(db);
            const classes = new PgClassRepository(db);
            return {
              attempts: new PgAttemptStore(db),
              profiles: new PgProfileStore(db),
              ids: async () => ({
                account: (
                  await players.upsertFromGoogle({
                    sub: `s${Math.random()}`,
                    email: 'a@b.c',
                    name: 'A',
                    domain: null,
                  })
                ).id,
                classId: (await classes.create(classInputSchema.parse({ name: 'C' }), null)).id,
              }),
            };
          },
        ] as [string, () => Promise<Made>],
      ]
    : []),
];

describe.each(implementations)('learning record stores: %s', (_n, make) => {
  it('keeps events and items, scored by the settings in force when they were written', async () => {
    const { attempts, ids } = await make();
    const { account, classId } = await ids();
    const solved = item({ accountId: account, classId });
    const dropped = item({
      accountId: account,
      classId,
      outcome: 'abandoned',
      runs: 0,
      submits: 0,
      secondsOpen: 3,
      finishedAt: 40_000,
    });
    const event: AttemptEvent = {
      at: 5_000,
      kind: 'issued',
      challengeId: solved.challengeId,
      who: { accountId: account, classId },
      questionId: 1,
      rewardKey: 'heal:small',
      detail: { seed: 'x' },
    };
    await attempts.writeBatch(
      [event],
      [
        { item: solved, who: { accountId: account, classId } },
        { item: dropped, who: { accountId: account, classId } },
      ],
      S,
    );
    const items = await attempts.itemsOf(account);
    expect(items.map((i) => [i.outcome, i.counted, i.earned, i.available])).toEqual([
      ['solved', true, 4, 4],
      ['abandoned', false, 0, 0],
    ]);
    expect(items[0]).toMatchObject({
      rcsbe: 'S',
      bloom: 'apply',
      marks: 4,
      topics: ['join'],
      round: 1,
      questionVersion: 1,
    });
    expect((await attempts.itemsOfClass(classId)).length).toBe(2);
    expect((await attempts.itemsOf(account, { classId: classId + 1000 })).length).toBe(0);
    const events = await attempts.eventsOf(account);
    expect(events).toMatchObject([{ kind: 'issued', detail: { seed: 'x' } }]);
  });

  it('adds profile deltas, scope by scope, and a second add stacks on the first', async () => {
    const { profiles, ids } = await make();
    const { account, classId } = await ids();
    const delta = addItem(emptyTotals(), item(), S);
    const scopes = [
      { kind: 'all' as const },
      { kind: 'class' as const, classId },
      { kind: 'round' as const, classId, round: 1 },
    ];
    await profiles.add(account, scopes, delta);
    await profiles.add(account, scopes.slice(0, 2), delta);
    expect((await profiles.load(account, { kind: 'all' })).rcsbe.S).toEqual({
      earned: 8,
      available: 8,
      items: 2,
    });
    expect((await profiles.load(account, { kind: 'class', classId })).bloom.apply.items).toBe(2);
    expect((await profiles.load(account, { kind: 'round', classId, round: 1 })).rcsbe.S.items).toBe(
      1,
    );
    expect((await profiles.load(account, { kind: 'round', classId, round: 2 })).rcsbe.S.items).toBe(
      0,
    );
    const grid = await profiles.loadClass(classId);
    expect(grid.map((g) => [g.accountId, g.totals.rcsbe.S.items])).toEqual([[account, 2]]);
  });
});

const quiet = () => {};

describe('ProfileAggregator (15.6)', () => {
  const setup = () => {
    const profiles = new InMemoryProfileStore();
    const sent: { account: number; message: ProfileMessage }[] = [];
    const agg = new ProfileAggregator(
      profiles,
      () => S,
      (account, message) => sent.push({ account, message }),
      quiet,
    );
    return { profiles, sent, agg };
  };
  const who = { accountId: 1, classId: 9, round: 2 };

  it('moves the live profile and pushes it, naming the axes that moved', async () => {
    const { agg, sent } = setup();
    agg.item(item({ rcsbe: 'C', bloom: 'understand' }), who);
    await agg.settled();
    expect(sent).toHaveLength(1);
    const m = sent[0]?.message as ProfileMessage;
    expect(m.moved).toEqual([
      { lens: 'rcsbe', dimension: 'C' },
      { lens: 'bloom', dimension: 'understand' },
    ]);
    expect(m.all.rcsbe.find((a) => a.dimension === 'C')).toMatchObject({
      items: 1,
      earned: 4,
      available: 4,
      score: null,
    });
    expect(m.class?.rcsbe.find((a) => a.dimension === 'C')?.items).toBe(1);
    expect(m.round?.rcsbe.find((a) => a.dimension === 'C')?.items).toBe(1);
  });

  it('ignores items that do not count, and unsigned players', async () => {
    const { agg, sent, profiles } = setup();
    agg.item(item({ tutorial: true }), who);
    agg.item(item({ outcome: 'abandoned', runs: 0, submits: 0, secondsOpen: 2 }), who);
    agg.item(item(), {});
    await agg.settled();
    expect(sent).toEqual([]);
    expect((await profiles.load(1, { kind: 'all' })).rcsbe.S.items).toBe(0);
  });

  it('starts from what is stored, and a student’s next round starts its own round totals', async () => {
    const { agg, sent, profiles } = setup();
    await profiles.add(1, [{ kind: 'all' }], addItem(emptyTotals(), item({ marks: 10 }), S));
    agg.item(item({ marks: 2 }), who);
    await agg.settled();
    expect(sent[0]?.message.all.rcsbe.find((a) => a.dimension === 'S')?.available).toBe(12);
    agg.item(item({ marks: 2 }), { ...who, round: 3 });
    await agg.settled();
    expect(sent[1]?.message.round?.rcsbe.find((a) => a.dimension === 'S')?.items).toBe(1);
    expect(sent[1]?.message.class?.rcsbe.find((a) => a.dimension === 'S')?.items).toBe(2);
  });

  it('live totals equal a full rebuild from the stored items, even when items arrive fast', async () => {
    const { agg, profiles } = setup();
    const list = Array.from({ length: 40 }, (_, i) =>
      item({
        challengeId: `c${i}`,
        rcsbe: (['R', 'C', 'S', 'B', 'E'] as const)[i % 5] as ItemRecord['rcsbe'],
        bloom: (['remember', 'understand', 'apply', 'analyze', 'evaluate', 'create'] as const)[
          i % 6
        ] as ItemRecord['bloom'],
        marks: 1 + (i % 5),
        hintsPaid: i % 3,
        outcome: i % 4 === 0 ? 'expired' : 'solved',
        submits: 1,
      }),
    );
    for (const it of list) agg.item(it, who);
    await agg.settled();
    const rebuilt = list.reduce<ProfileTotals>((t, i) => addItem(t, i, S), emptyTotals());
    expect(await profiles.load(1, { kind: 'all' })).toEqual(rebuilt);
    expect(await profiles.load(1, { kind: 'class', classId: 9 })).toEqual(rebuilt);
  });

  it('gives a joining student their profile, and reports a failing store without crashing', async () => {
    const { agg, profiles } = setup();
    await profiles.add(1, [{ kind: 'all' }], addItem(emptyTotals(), item(), S));
    const joined = await agg.profileOf(1);
    expect(joined.all.rcsbe.find((a) => a.dimension === 'S')?.items).toBe(1);
    const errors: unknown[] = [];
    const broken = new ProfileAggregator(
      {
        ...profiles,
        load: async () => {
          throw new Error('db down');
        },
        add: async () => {},
        loadClass: async () => [],
        loadRounds: async () => [],
      } as ProfileStore,
      () => S,
      () => {},
      (e) => errors.push(e),
    );
    broken.item(item({ accountId: 2 }), { accountId: 2 });
    await broken.settled();
    expect(errors).toHaveLength(1);
  });

  it('scopeView scores both lenses and names the weakest axis with enough evidence', () => {
    let t = emptyTotals();
    for (let i = 0; i < 3; i++)
      t = addItem(t, item({ rcsbe: 'C', marks: 3, outcome: 'expired', submits: 1 }), S);
    for (let i = 0; i < 3; i++) t = addItem(t, item({ rcsbe: 'S', marks: 3 }), S);
    const view = scopeView(t, S);
    expect(view.focus).toEqual({ lens: 'rcsbe', dimension: 'C' });
    expect(view.rcsbe).toHaveLength(5);
    expect(view.bloom).toHaveLength(6);
    expect(axisScores(t, 'rcsbe', S)).toEqual(view.rcsbe);
  });
});

describe('skill source (16.7)', () => {
  it('answers from the live profile once it is loaded: none for a newcomer, easier for a struggling student', async () => {
    const profiles = new InMemoryProfileStore();
    const agg = new ProfileAggregator(
      profiles,
      () => S,
      () => {},
      quiet,
    );
    expect(agg.skillOf(1)).toBeUndefined(); // not loaded yet
    await agg.profileOf(1);
    await new Promise((r) => setTimeout(r, 0));
    expect(agg.skillOf(1)).toEqual({ tierShift: 0, ttlScale: 1, rewardScale: 1 }); // newcomer
    for (let i = 0; i < 8; i++)
      agg.item(item({ challengeId: `f${i}`, outcome: 'expired', submits: 1 }), { accountId: 1 });
    agg.item(item({ challengeId: 's' }), { accountId: 1 });
    await agg.settled();
    expect(agg.skillOf(1)).toMatchObject({ tierShift: -2 }); // 4 of 36 marks
    agg.forget(1);
    expect(agg.skillOf(1)).toBeUndefined();
  });
});

describe('weak topics come back (16.8)', () => {
  it('names the weakest topics with enough evidence from the stored history, and learns as the student plays', async () => {
    const history = [
      ...Array.from({ length: 3 }, (_, i) =>
        item({ challengeId: `a${i}`, topics: ['cte'], outcome: 'expired', submits: 1 }),
      ),
      ...Array.from({ length: 3 }, (_, i) => item({ challengeId: `b${i}`, topics: ['where'] })),
      ...Array.from({ length: 4 }, (_, i) =>
        item({
          challengeId: `c${i}`,
          topics: ['join'],
          outcome: i === 0 ? 'solved' : 'expired',
          submits: 1,
        }),
      ),
      item({ challengeId: 'd', topics: ['rare'], outcome: 'expired', submits: 1 }),
    ];
    const agg = new ProfileAggregator(
      new InMemoryProfileStore(),
      () => S,
      () => {},
      quiet,
      async () => history,
    );
    expect(agg.focusOf(1)).toBeUndefined(); // not loaded yet
    await agg.profileOf(1);
    await new Promise((r) => setTimeout(r, 0));
    expect(agg.focusOf(1)).toEqual(['cte', 'join', 'where'].filter((t) => t !== 'where')); // 'where' is perfect, 'rare' has one item
    for (let i = 0; i < 3; i++)
      agg.item(
        item({ challengeId: `n${i}`, topics: ['subquery'], outcome: 'expired', submits: 1 }),
        { accountId: 1 },
      );
    await agg.settled();
    expect(agg.focusOf(1)).toContain('subquery');
  });
});

describe('BatchingRecorder (15.2)', () => {
  it('saves in batches off the tick, in order, and flush waits for the save', async () => {
    const saved: number[] = [];
    const rec = new BatchingRecorder(
      async (events, items) => {
        await new Promise((r) => setTimeout(r, 5));
        saved.push(events.length * 100 + items.length);
      },
      quiet,
      10_000,
    );
    const e = (n: number): AttemptEvent => ({
      at: n,
      kind: 'run',
      challengeId: 'c',
      who: {},
      questionId: 1,
      rewardKey: 'x',
    });
    rec.event(e(1));
    rec.event(e(2));
    rec.item(item(), {});
    expect(saved).toEqual([]); // nothing written on the caller's turn
    await rec.flush();
    expect(saved).toEqual([201]);
    await rec.flush(); // nothing new: nothing written
    expect(saved).toEqual([201]);
  });

  it('flushes early when a lot piles up, reports a failed save, and carries on', async () => {
    const errors: unknown[] = [];
    let calls = 0;
    const rec = new BatchingRecorder(
      async () => {
        calls++;
        if (calls === 1) throw new Error('disk full');
      },
      (err) => errors.push(err),
      10_000,
      3,
    );
    for (let i = 0; i < 3; i++) rec.item(item(), {});
    await rec.flush();
    expect(errors).toHaveLength(1);
    rec.item(item(), {});
    await rec.flush();
    expect(calls).toBe(2);
  });
});

describe('RetentionJob (15.17)', () => {
  const DAY = 86_400_000;
  const make = async () => {
    const attempts = new InMemoryAttemptStore();
    const now = 1_000 * DAY;
    const ev = (daysAgo: number): AttemptEvent => ({
      at: now - daysAgo * DAY,
      kind: 'run',
      challengeId: 'c',
      who: { accountId: 1 },
      questionId: 1,
      rewardKey: 'x',
    });
    const it = (daysAgo: number) =>
      item({ challengeId: `i${daysAgo}`, finishedAt: now - daysAgo * DAY });
    await attempts.writeBatch(
      [ev(10), ev(200), ev(400)],
      [it(10), it(500), it(800)].map((i) => ({ item: i, who: { accountId: 1 } })),
      S,
    );
    return { attempts, now };
  };

  it('removes raw events and items past their time and keeps the rest', async () => {
    const { attempts, now } = await make();
    const job = new RetentionJob(
      attempts,
      () => S,
      () => now,
    );
    expect(await job.run()).toEqual({ events: 2, items: 1 });
    expect((await attempts.eventsOf(1)).length).toBe(1);
    expect((await attempts.itemsOf(1)).map((i) => i.challengeId).sort()).toEqual(['i10', 'i500']);
    expect(await job.run()).toEqual({ events: 0, items: 0 }); // nothing more to do
  });

  it('keeps everything when a setting is 0, and follows the settings', async () => {
    const { attempts, now } = await make();
    const keep = analyticsSettingsSchema.parse({ rawEventDays: 0, itemDays: 0 });
    expect(
      await new RetentionJob(
        attempts,
        () => keep,
        () => now,
      ).run(),
    ).toEqual({ events: 0, items: 0 });
    const short = analyticsSettingsSchema.parse({ rawEventDays: 5, itemDays: 5 });
    expect(
      await new RetentionJob(
        attempts,
        () => short,
        () => now,
      ).run(),
    ).toEqual({ events: 3, items: 3 });
  });

  it('does not touch the profile totals', async () => {
    const { attempts, now } = await make();
    const profiles = new InMemoryProfileStore();
    await profiles.add(1, [{ kind: 'all' }], addItem(emptyTotals(), item(), S));
    await new RetentionJob(
      attempts,
      () => analyticsSettingsSchema.parse({ rawEventDays: 1, itemDays: 1 }),
      () => now,
    ).run();
    expect((await profiles.load(1, { kind: 'all' })).rcsbe.S.items).toBe(1);
  });
});
