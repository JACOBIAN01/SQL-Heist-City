import { afterAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, freshPg } from '../pg/testing';
import { PgPlayerRepository } from '../players/PlayerRepository';
import { InMemoryUpgradeStore, PgUpgradeStore, type UpgradeStore } from './UpgradeStore';

const drops: (() => Promise<void>)[] = [];
afterAll(() => Promise.all(drops.map((d) => d())));

const impls: [string, () => Promise<{ store: UpgradeStore; player: () => Promise<number> }>][] = [
  ['in memory', async () => ({ store: new InMemoryUpgradeStore(), player: async () => 1 })],
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
        store: new PgUpgradeStore(db),
        player: async () =>
          (
            await players.upsertFromGoogle({
              sub: `u${++n}`,
              email: `u${n}@x.test`,
              name: 'U',
              domain: null,
            })
          ).id,
      };
    },
  ]);

describe.each(impls)('UpgradeStore (%s)', (_n, make) => {
  it('starts with nothing, and keeps the level set, replacing it as it rises', async () => {
    const { store, player } = await make();
    const id = await player();
    expect(await store.levels(id)).toEqual({});
    await store.setLevel(id, 'banking', 1);
    await store.setLevel(id, 'banking', 2);
    await store.setLevel(id, 'stash', 1);
    expect(await store.levels(id)).toEqual({ banking: 2, stash: 1 });
  });

  it('forgets everything of a removed student', async () => {
    const { store, player } = await make();
    const id = await player();
    await store.setLevel(id, 'armour', 3);
    await store.remove(id);
    expect(await store.levels(id)).toEqual({});
  });
});
