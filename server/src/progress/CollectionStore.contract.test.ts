import { afterAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, freshPg } from '../pg/testing';
import { PgPlayerRepository } from '../players/PlayerRepository';
import {
  InMemoryCollectionStore,
  PgCollectionStore,
  type CollectionStore,
} from './CollectionStore';

const drops: (() => Promise<void>)[] = [];
afterAll(() => Promise.all(drops.map((d) => d())));

const impls: [string, () => Promise<{ store: CollectionStore; player: () => Promise<number> }>][] =
  [['in memory', async () => ({ store: new InMemoryCollectionStore(), player: async () => 1 })]];
if (TEST_DATABASE_URL)
  impls.push([
    'PostgreSQL',
    async () => {
      const { db, drop } = await freshPg();
      drops.push(drop);
      const players = new PgPlayerRepository(db);
      let n = 0;
      return {
        store: new PgCollectionStore(db),
        player: async () =>
          (
            await players.upsertFromGoogle({
              sub: `k${++n}`,
              email: `k${n}@x.test`,
              name: 'K',
              domain: null,
            })
          ).id,
      };
    },
  ]);

describe.each(impls)('CollectionStore (%s)', (_n, make) => {
  it('starts empty, records a find once, and keeps it', async () => {
    const { store, player } = await make();
    const id = await player();
    expect((await store.found(id)).size).toBe(0);
    expect(await store.add(id, 'city:1')).toBe(true);
    expect(await store.add(id, 'city:1')).toBe(false);
    await store.add(id, 'city:2');
    expect([...(await store.found(id))].sort()).toEqual(['city:1', 'city:2']);
  });

  it('keeps each student’s chips apart, and forgets them on removal', async () => {
    const { store, player } = await make();
    const a = await player();
    const b = await player();
    await store.add(a, 'city:1');
    if (a !== b) expect((await store.found(b)).size).toBe(0);
    await store.remove(a);
    expect((await store.found(a)).size).toBe(0);
  });
});
