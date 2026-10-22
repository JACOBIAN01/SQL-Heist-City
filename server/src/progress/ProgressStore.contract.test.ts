import { afterAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, freshPg } from '../pg/testing';
import { PgPlayerRepository } from '../players/PlayerRepository';
import { InMemoryProgressStore, PgProgressStore, type ProgressStore } from './ProgressStore';

const drops: (() => Promise<void>)[] = [];
afterAll(() => Promise.all(drops.map((d) => d())));

const implementations: [
  string,
  () => Promise<{ store: ProgressStore; player: () => Promise<number> }>,
][] = [['in memory', async () => ({ store: new InMemoryProgressStore(), player: async () => 1 })]];
if (TEST_DATABASE_URL)
  implementations.push([
    'PostgreSQL',
    async () => {
      const { db, drop } = await freshPg();
      drops.push(drop);
      const players = new PgPlayerRepository(db);
      let n = 0;
      return {
        store: new PgProgressStore(db),
        player: async () =>
          (
            await players.upsertFromGoogle({
              sub: `s${++n}`,
              email: `p${n}@x.test`,
              name: 'P',
              domain: null,
            })
          ).id,
      };
    },
  ]);

describe.each(implementations)('ProgressStore (%s)', (_name, make) => {
  it('starts at nothing and adds up, learning and play apart', async () => {
    const { store, player } = await make();
    const id = await player();
    expect(await store.get(id)).toEqual({ learningXp: 0, playXp: 0 });
    await store.add(id, { learningXp: 30 });
    await store.add(id, { playXp: 12 });
    expect(await store.add(id, { learningXp: 5, playXp: 3 })).toEqual({
      learningXp: 35,
      playXp: 15,
    });
    expect(await store.get(id)).toEqual({ learningXp: 35, playXp: 15 });
  });

  it('does not lose XP when two writers add at once', async () => {
    const { store, player } = await make();
    const id = await player();
    await Promise.all(Array.from({ length: 20 }, () => store.add(id, { learningXp: 1 })));
    expect((await store.get(id)).learningXp).toBe(20);
  });

  it('forgets a player on removal', async () => {
    const { store, player } = await make();
    const id = await player();
    await store.add(id, { learningXp: 9 });
    await store.remove(id);
    expect(await store.get(id)).toEqual({ learningXp: 0, playXp: 0 });
  });

  it('keeps season XP apart per season, adds up, and goes with the player', async () => {
    const { store, player } = await make();
    const id = await player();
    expect(await store.seasonXp(id)).toEqual({});
    await store.addSeason(id, 'autumn', 40);
    await store.addSeason(id, 'autumn', 10);
    await store.addSeason(id, 'spring', 5);
    expect(await store.seasonXp(id)).toEqual({ autumn: 50, spring: 5 });
    await store.remove(id);
    expect(await store.seasonXp(id)).toEqual({});
  });
});
