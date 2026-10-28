import { afterAll, describe, expect, it } from 'vitest';
import { REPLAYS_KEPT_PER_CLASS, classInputSchema } from '@heist/shared';
import type { RoundResult } from '../heist/HeistEvents';
import { TEST_DATABASE_URL, freshPg } from '../pg/testing';
import { PgPlayerRepository } from '../players/PlayerRepository';
import { PgClassRepository } from './ClassRepository';
import { InMemoryClassResults, PgClassResults, type ClassResultRepository } from './ClassResults';

const drops: (() => Promise<void>)[] = [];
afterAll(() => Promise.all(drops.map((d) => d())));

interface Made {
  results: ClassResultRepository;
  newClass: () => Promise<number>;
  newPlayer: (sub: string) => Promise<number>;
}

const implementations: [string, () => Promise<Made>][] = [
  [
    'in memory',
    async () => {
      let n = 0;
      return {
        results: new InMemoryClassResults(),
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
              results: new PgClassResults(db),
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

const result = (
  number: number,
  accountIds: number[],
  over: Partial<RoundResult> = {},
): RoundResult => ({
  number,
  startedAt: Date.parse('2026-03-01T10:00:00Z'),
  endedAt: Date.parse('2026-03-01T10:15:00Z'),
  standings: accountIds.map((id, i) => ({
    rank: i + 1,
    accountId: id,
    name: `S${id}`,
    banked: 5000 - i * 1000,
    kills: 3 - i,
    deaths: i,
  })),
  awards: [{ id: 'top_gun', playerId: 1, name: 'S1', value: 3 }],
  ...over,
});

describe.each(implementations)('class results: %s', (_n, make) => {
  it('records a round and lists it with its winner and size, newest first', async () => {
    const { results, newClass, newPlayer } = await make();
    const c = await newClass();
    const [a, b] = [await newPlayer('a'), await newPlayer('b')];
    const r1 = await results.record(c, result(1, [a, b]));
    await results.record(c, result(2, [b, a]));
    expect(r1).toMatchObject({
      classId: c,
      number: 1,
      players: 2,
      winner: { name: `S${a}`, banked: 5000 },
    });
    expect((await results.rounds(c)).map((r) => r.number)).toEqual([2, 1]);
    expect(await results.rounds(c + 100)).toEqual([]);
  });

  it('shows the full table of a round, but never a round of another class', async () => {
    const { results, newClass, newPlayer } = await make();
    const c = await newClass();
    const other = await newClass();
    const [a, b] = [await newPlayer('a'), await newPlayer('b')];
    const r = await results.record(c, result(1, [a, b]));
    const detail = await results.round(c, r.id);
    expect(detail?.standings.map((s) => [s.rank, s.name, s.banked, s.kills, s.deaths])).toEqual([
      [1, `S${a}`, 5000, 3, 0],
      [2, `S${b}`, 4000, 2, 1],
    ]);
    expect(detail?.round.awards).toHaveLength(1);
    expect(await results.round(other, r.id)).toBeUndefined();
  });

  it('keeps the recording of a round, only for its own class, and only the newest ones', async () => {
    const { results, newClass, newPlayer } = await make();
    const c = await newClass();
    const other = await newClass();
    const a = await newPlayer('a');
    const replay = {
      step: 3,
      seconds: 9,
      tracks: [{ name: 'A', from: 0, points: [1, 2, 3, 4] }],
      events: [{ at: 4, kind: 'banked' as const, who: 'A', text: '500' }],
    };
    const first = await results.record(c, result(1, [a], { replay }));
    expect(first.hasReplay).toBe(true);
    expect(await results.replay(c, first.id)).toEqual(replay);
    expect(await results.replay(other, first.id)).toBeUndefined();
    const plain = await results.record(c, result(2, [a]));
    expect(plain.hasReplay).toBe(false);
    expect(await results.replay(c, plain.id)).toBeUndefined();
    for (let n = 3; n < 3 + REPLAYS_KEPT_PER_CLASS; n++)
      await results.record(c, result(n, [a], { replay }));
    expect(await results.replay(c, first.id)).toBeUndefined();
    expect((await results.rounds(c)).find((r) => r.id === first.id)?.hasReplay).toBe(false);
    expect((await results.round(c, first.id))?.standings).toHaveLength(1);
  });

  it('says there was no winner when nobody banked anything', async () => {
    const { results, newClass, newPlayer } = await make();
    const c = await newClass();
    const a = await newPlayer('a');
    const r = await results.record(
      c,
      result(1, [a], {
        standings: [{ rank: 1, accountId: a, name: 'A', banked: 0, kills: 0, deaths: 0 }],
      }),
    );
    expect(r.winner).toBeNull();
  });

  it('follows one student through the rounds', async () => {
    const { results, newClass, newPlayer } = await make();
    const c = await newClass();
    const [a, b] = [await newPlayer('a'), await newPlayer('b')];
    await results.record(c, result(1, [a, b]));
    await results.record(c, result(2, [b, a]));
    const mine = await results.forPlayer(c, a);
    expect(mine.map((m) => [m.round.number, m.standing.rank])).toEqual([
      [1, 1],
      [2, 2],
    ]);
    expect(await results.forPlayer(c, 9999)).toEqual([]);
  });

  it('totals cash and rounds per student inside a period, by when the round ended', async () => {
    const { results, newClass, newPlayer } = await make();
    const c = await newClass();
    const [a, b] = [await newPlayer('a'), await newPlayer('b')];
    const at = (iso: string) => ({
      startedAt: Date.parse(iso) - 900_000,
      endedAt: Date.parse(iso),
    });
    await results.record(c, result(1, [a, b], at('2026-10-19T10:00:00Z'))); // in the week
    await results.record(c, result(2, [b, a], at('2026-10-22T10:00:00Z'))); // in the week
    await results.record(c, result(3, [a], at('2026-10-26T00:00:00Z'))); // next week: the end is not included
    await results.record(c, result(4, [a], at('2026-10-18T23:59:59Z'))); // the week before
    const totals = await results.totalsBetween(
      c,
      new Date('2026-10-19T00:00:00Z'),
      new Date('2026-10-26T00:00:00Z'),
    );
    const byId = Object.fromEntries(totals.map((t) => [t.playerId, t]));
    expect(byId[a]).toMatchObject({ banked: 5000 + 4000, rounds: 2 });
    expect(byId[b]).toMatchObject({ banked: 4000 + 5000, rounds: 2 });
    expect(await results.totalsBetween(c + 100, new Date(0), new Date('2100-01-01'))).toEqual([]);
  });

  it('lists a student’s latest rounds over every class, newest first, up to a limit', async () => {
    const { results, newClass, newPlayer } = await make();
    const [c1, c2] = [await newClass(), await newClass()];
    const [a, b] = [await newPlayer('a'), await newPlayer('b')];
    await results.record(c1, result(1, [a, b]));
    await results.record(c2, result(1, [b, a]));
    await results.record(c1, result(2, [a]));
    const recent = await results.recentForPlayer(a, 2);
    expect(recent.map((r) => [r.round.classId, r.round.number, r.standing.rank])).toEqual([
      [c1, 2, 1],
      [c2, 1, 2],
    ]);
    expect(await results.recentForPlayer(a, 10)).toHaveLength(3);
    expect(await results.recentForPlayer(b, 10)).toHaveLength(2);
  });
});
