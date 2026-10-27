import { afterAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, freshPg } from '../pg/testing';
import { PgPlayerRepository } from '../players/PlayerRepository';
import { InMemoryStoryStore, PgStoryStore, type StoryStore } from './StoryStore';

const drops: (() => Promise<void>)[] = [];
afterAll(() => Promise.all(drops.map((d) => d())));

const impls: [string, () => Promise<{ store: StoryStore; player: () => Promise<number> }>][] = [
  ['in memory', async () => ({ store: new InMemoryStoryStore(), player: async () => 1 })],
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
        store: new PgStoryStore(db),
        player: async () =>
          (
            await players.upsertFromGoogle({
              sub: `s${++n}`,
              email: `s${n}@x.test`,
              name: 'S',
              domain: null,
            })
          ).id,
      };
    },
  ]);

describe.each(impls)('StoryStore (%s)', (_n, make) => {
  it('starts empty and keeps the latest step of each chain', async () => {
    const { store, player } = await make();
    const id = await player();
    expect(await store.steps(id)).toEqual({});
    await store.setStep(id, 'bank-1', 1);
    await store.setStep(id, 'bank-1', 3);
    await store.setStep(id, 'bank-2', 1);
    expect(await store.steps(id)).toEqual({ 'bank-1': 3, 'bank-2': 1 });
  });

  it('forgets everything of a removed student', async () => {
    const { store, player } = await make();
    const id = await player();
    await store.setStep(id, 'bank-4', 2);
    await store.remove(id);
    expect(await store.steps(id)).toEqual({});
  });
});
