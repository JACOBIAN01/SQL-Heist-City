import { afterAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, freshPg } from '../pg/testing';
import { PgPlayerRepository } from '../players/PlayerRepository';
import { InMemoryGhostStore, PgGhostStore, type GhostRun, type GhostStore } from './GhostStore';

const drops: (() => Promise<void>)[] = [];
afterAll(() => Promise.all(drops.map((d) => d())));

const impls: [
  string,
  () => Promise<{ store: GhostStore; player: (n: string) => Promise<number> }>,
][] = [
  [
    'in memory',
    async () => {
      let n = 0;
      return { store: new InMemoryGhostStore(), player: async () => ++n };
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
        store: new PgGhostStore(db),
        player: async (name: string) =>
          (
            await players.upsertFromGoogle({
              sub: `g${++n}`,
              email: `g${n}@x.test`,
              name,
              domain: null,
            })
          ).id,
      };
    },
  ]);

const run = (
  playerId: number,
  name: string,
  seconds: number,
  take = 1000,
  bank = 'bank-1',
): GhostRun => ({
  bank,
  playerId,
  name,
  seconds,
  take,
  trace: { step: 1, points: [0, 0, 0, 1, 0, 1] },
});

describe.each(impls)('GhostStore (%s)', (_n, make) => {
  it('keeps a student’s fastest run per bank, and says whether a run was kept', async () => {
    const { store, player } = await make();
    const a = await player('Ana');
    expect(await store.save(run(a, 'Ana', 120))).toBe(true);
    expect(await store.save(run(a, 'Ana', 150))).toBe(false);
    expect(await store.save(run(a, 'Ana', 90))).toBe(true);
    expect((await store.best('bank-1'))?.seconds).toBe(90);
  });

  it('gives the fastest of all as the ghost, with the bigger take breaking a tie', async () => {
    const { store, player } = await make();
    const [a, b, c] = [await player('Ana'), await player('Ben'), await player('Cy')];
    await store.save(run(a, 'Ana', 100, 5000));
    await store.save(run(b, 'Ben', 80, 2000));
    await store.save(run(c, 'Cy', 80, 9000));
    const best = await store.best('bank-1');
    expect(best).toMatchObject({ name: 'Cy', seconds: 80, take: 9000 });
    expect(best?.trace.points).toHaveLength(6);
  });

  it('keeps each bank apart, has no ghost where nobody has run, and forgets a removed student', async () => {
    const { store, player } = await make();
    const a = await player('Ana');
    await store.save(run(a, 'Ana', 60, 1, 'bank-2'));
    expect(await store.best('bank-1')).toBeUndefined();
    expect((await store.best('bank-2'))?.name).toBe('Ana');
    await store.remove(a);
    expect(await store.best('bank-2')).toBeUndefined();
  });
});
