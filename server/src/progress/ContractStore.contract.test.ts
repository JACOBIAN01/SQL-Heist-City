import { afterAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, freshPg } from '../pg/testing';
import { PgPlayerRepository } from '../players/PlayerRepository';
import { InMemoryContractStore, PgContractStore, type ContractStore } from './ContractStore';

const drops: (() => Promise<void>)[] = [];
afterAll(() => Promise.all(drops.map((d) => d())));

const impls: [string, () => Promise<{ store: ContractStore; player: () => Promise<number> }>][] = [
  ['in memory', async () => ({ store: new InMemoryContractStore(), player: async () => 1 })],
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
        store: new PgContractStore(db),
        player: async () =>
          (
            await players.upsertFromGoogle({
              sub: `c${++n}`,
              email: `c${n}@x.test`,
              name: 'C',
              domain: null,
            })
          ).id,
      };
    },
  ]);

describe.each(impls)('ContractStore (%s)', (_n, make) => {
  it('keeps a day’s contracts and replaces them as progress is made', async () => {
    const { store, player } = await make();
    const id = await player();
    expect(await store.getDay(id, '2026-10-20')).toBeUndefined();
    await store.putDay(id, '2026-10-20', [{ id: 'a', progress: 1, done: false }]);
    await store.putDay(id, '2026-10-20', [{ id: 'a', progress: 3, done: true }]);
    expect(await store.getDay(id, '2026-10-20')).toEqual([{ id: 'a', progress: 3, done: true }]);
    expect(await store.getDay(id, '2026-10-21')).toBeUndefined();
  });

  it('keeps the day streak, empty at first', async () => {
    const { store, player } = await make();
    const id = await player();
    expect(await store.getStreak(id)).toEqual({ days: 0, lastDay: '' });
    await store.putStreak(id, { days: 3, lastDay: '2026-10-20' });
    expect(await store.getStreak(id)).toEqual({ days: 3, lastDay: '2026-10-20' });
  });

  it('forgets old days and everything of a removed player', async () => {
    const { store, player } = await make();
    const id = await player();
    await store.putDay(id, '2026-10-01', [{ id: 'a', progress: 0, done: false }]);
    await store.putDay(id, '2026-10-20', [{ id: 'a', progress: 0, done: false }]);
    expect(await store.pruneBefore('2026-10-10')).toBe(1);
    expect(await store.getDay(id, '2026-10-01')).toBeUndefined();
    expect(await store.getDay(id, '2026-10-20')).toBeDefined();
    await store.putStreak(id, { days: 2, lastDay: '2026-10-20' });
    await store.remove(id);
    expect(await store.getDay(id, '2026-10-20')).toBeUndefined();
    expect(await store.getStreak(id)).toEqual({ days: 0, lastDay: '' });
  });
});
