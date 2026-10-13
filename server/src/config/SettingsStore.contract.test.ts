import { afterAll, describe, expect, it } from 'vitest';
import { questionTemplateSchema } from '@heist/shared';
import { sampleQuestion } from '@heist/shared/fixtures';
import { openDatabase } from '../db/database';
import { TEST_DATABASE_URL, freshPg } from '../pg/testing';
import { PgQuestionStore } from '../questions/PgQuestionStore';
import { SqliteQuestionRepository } from '../questions/SqliteQuestionRepository';
import { PgSettingsStore, SqliteSettingsStore, type SettingsStore } from './SettingsStore';

const drops: (() => Promise<void>)[] = [];
afterAll(() => Promise.all(drops.map((d) => d())));

type Made = { store: SettingsStore; addQuestion: (slug: string) => Promise<void> };
const template = (slug: string) => ({ ...questionTemplateSchema.parse(sampleQuestion), slug });

const implementations: [string, () => Promise<Made>][] = [
  [
    'SqliteSettingsStore',
    async () => {
      const db = openDatabase({ path: ':memory:' });
      const questions = new SqliteQuestionRepository(db);
      return {
        store: new SqliteSettingsStore(db),
        addQuestion: async (slug) => void questions.create(template(slug), null),
      };
    },
  ],
  ...(TEST_DATABASE_URL
    ? [
        [
          'PgSettingsStore',
          async () => {
            const { db, drop } = await freshPg();
            drops.push(drop);
            const questions = new PgQuestionStore(db);
            return {
              store: new PgSettingsStore(db),
              addQuestion: async (slug: string) =>
                void (await questions.create(template(slug), null)),
            };
          },
        ] as [string, () => Promise<Made>],
      ]
    : []),
];

describe.each(implementations)('%s', (_name, make) => {
  it('stores and replaces a settings value, and reports a missing one as undefined', async () => {
    const { store } = await make();
    expect(await store.get('heist')).toBeUndefined();
    await store.put('heist', { killBonus: 5, nested: { a: [1, 2] } });
    expect(await store.get('heist')).toEqual({ killBonus: 5, nested: { a: [1, 2] } });
    await store.put('heist', { killBonus: 6 });
    expect(await store.get('heist')).toEqual({ killBonus: 6 });
  });

  it('applies reward overrides together and removes them with null', async () => {
    const { store } = await make();
    await store.applyRewards([
      { key: 'gun:rifle', override: { min: 2, max: 3 } },
      { key: 'gun:smg', override: { min: 1, max: 1 } },
    ]);
    expect((await store.rewardOverrides()).sort((a, b) => a.key.localeCompare(b.key))).toEqual([
      { key: 'gun:rifle', min: 2, max: 3 },
      { key: 'gun:smg', min: 1, max: 1 },
    ]);
    await store.applyRewards([
      { key: 'gun:rifle', override: null },
      { key: 'gun:smg', override: { min: 2, max: 4 } },
    ]);
    expect(await store.rewardOverrides()).toEqual([{ key: 'gun:smg', min: 2, max: 4 }]);
  });

  it('refuses an invalid reward range and changes nothing', async () => {
    const { store } = await make();
    await expect(
      store.applyRewards([
        { key: 'gun:rifle', override: { min: 1, max: 2 } },
        { key: 'gun:smg', override: { min: 5, max: 1 } },
      ]),
    ).rejects.toThrow();
    expect(await store.rewardOverrides()).toEqual([]);
  });

  it('knows whether a live question has a slug', async () => {
    const { store, addQuestion } = await make();
    expect(await store.questionSlugExists('t1-a')).toBe(false);
    await addQuestion('t1-a');
    expect(await store.questionSlugExists('t1-a')).toBe(true);
  });
});
