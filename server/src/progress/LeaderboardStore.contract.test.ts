import { afterAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, freshPg } from '../pg/testing';
import { PgPlayerRepository } from '../players/PlayerRepository';
import {
  InMemoryLeaderboardStore,
  PgLeaderboardStore,
  type LeaderboardStore,
} from './LeaderboardStore';

const drops: (() => Promise<void>)[] = [];
afterAll(() => Promise.all(drops.map((d) => d())));

const impls: [
  string,
  () => Promise<{ store: LeaderboardStore; player: (n: string) => Promise<number> }>,
][] = [
  [
    'in memory',
    async () => {
      let n = 0;
      return { store: new InMemoryLeaderboardStore(), player: async () => ++n };
    },
  ],
];
if (TEST_DATABASE_URL)
  impls.push([
    'PostgreSQL',
    async () => {
      const { db, drop } = await freshPg();
      drops.push(drop);
      const players = new PgPlayerRepository(db);
      let n = 0;
      return {
        store: new PgLeaderboardStore(db),
        player: async (name: string) =>
          (
            await players.upsertFromGoogle({
              sub: `q${++n}`,
              email: `q${n}@x.test`,
              name,
              domain: null,
            })
          ).id,
      };
    },
  ]);

describe.each(impls)('LeaderboardStore (%s)', (_n, make) => {
  it('keeps each student’s leanest query and says whether a try is a new best', async () => {
    const { store, player } = await make();
    const a = await player('Ana');
    expect(await store.record(a, 'Ana', null, 7, { scanned: 100, length: 80 })).toBe(true);
    expect(await store.record(a, 'Ana', null, 7, { scanned: 100, length: 90 })).toBe(false);
    expect(await store.record(a, 'Ana', null, 7, { scanned: 100, length: 60 })).toBe(true);
    expect(await store.record(a, 'Ana', null, 7, { scanned: 40, length: 200 })).toBe(true);
    const board = await store.board(7, a, {}, 5);
    expect(board?.top[0]).toMatchObject({ scanned: 40, length: 200 });
    expect(board?.top).toHaveLength(1);
  });

  it('ranks fewer rows scanned first, then a shorter query, per question', async () => {
    const { store, player } = await make();
    const [a, b, c] = [await player('Ana'), await player('Ben'), await player('Cy')];
    await store.record(a, 'Ana', null, 1, { scanned: 50, length: 70 });
    await store.record(b, 'Ben', null, 1, { scanned: 50, length: 40 });
    await store.record(c, 'Cy', null, 1, { scanned: 10, length: 300 });
    await store.record(a, 'Ana', null, 2, { scanned: 5, length: 5 });
    const board = await store.board(1, a, {}, 10);
    expect(board?.top.map((r) => r.name)).toEqual(['Cy', 'Ben', 'Ana']);
    expect(board).toMatchObject({ rank: 3, of: 3 });
    expect((await store.board(2, a, {}, 10))?.of).toBe(1);
    expect(await store.board(3, a, {}, 10)).toBeUndefined(); // no record, no place
  });

  it('can be read for one class only, and forgets a removed student', async () => {
    const { store, player } = await make();
    const [a, b] = [await player('Ana'), await player('Ben')];
    await store.record(a, 'Ana', 11, 1, { scanned: 20, length: 20 });
    await store.record(b, 'Ben', 12, 1, { scanned: 10, length: 10 });
    expect((await store.board(1, a, { classId: 11 }, 10))?.of).toBe(1);
    expect((await store.board(1, a, {}, 10))?.of).toBe(2);
    await store.remove(b);
    expect((await store.board(1, a, {}, 10))?.of).toBe(1);
  });
});
