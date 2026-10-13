import { afterAll, describe, expect, it } from 'vitest';
import { conceptCardSchema, conceptFileSchema } from '@heist/shared';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../db/database';
import { TEST_DATABASE_URL, freshPg } from '../pg/testing';
import {
  PgConceptStore,
  SqliteConceptReader,
  SqliteConceptStore,
  StaticConcepts,
  type ConceptStore,
} from './ConceptStore';

const drops: (() => Promise<void>)[] = [];
afterAll(() => Promise.all(drops.map((d) => d())));

const implementations: [string, () => Promise<ConceptStore>][] = [
  ['SQLite', async () => new SqliteConceptStore(openDatabase({ path: ':memory:' }))],
  ...(TEST_DATABASE_URL
    ? [
        [
          'PostgreSQL',
          async () => {
            const { db, drop } = await freshPg();
            drops.push(drop);
            return new PgConceptStore(db);
          },
        ] as [string, () => Promise<ConceptStore>],
      ]
    : []),
];

const card = (over = {}) =>
  conceptCardSchema.parse({
    topic: 'group-by',
    title: 'GROUP BY',
    nudge: 'Group rows.',
    body_md: 'One row per group.',
    ...over,
  });

describe.each(implementations)('concept cards: %s', (_n, make) => {
  it('creates a card at version 1 and a new version on every save, keeping the history', async () => {
    const store = await make();
    const first = await store.save(card(), 'ana@school.test');
    expect(first).toMatchObject({ topic: 'group-by', version: 1, updatedBy: 'ana@school.test' });
    const second = await store.save(card({ body_md: 'Better words.' }), 'ben@school.test');
    expect(second).toMatchObject({ version: 2, body_md: 'Better words.' });
    expect((await store.get('group-by'))?.body_md).toBe('Better words.');
    expect(
      (await store.versions('group-by')).map((v) => [v.version, v.body_md, v.createdBy]),
    ).toEqual([
      [1, 'One row per group.', 'ana@school.test'],
      [2, 'Better words.', 'ben@school.test'],
    ]);
  });

  it('lists by topic and reports a missing card as undefined', async () => {
    const store = await make();
    await store.save(card({ topic: 'where' }), null);
    await store.save(card({ topic: 'having' }), null);
    expect((await store.list()).map((c) => c.topic)).toEqual(['having', 'where']);
    expect(await store.get('nope')).toBeUndefined();
    expect(await store.versions('nope')).toEqual([]);
  });
});

describe('concept readers', () => {
  it('the game reads cards from its snapshot, and sees edits after invalidate', async () => {
    const db = openDatabase({ path: ':memory:' });
    const store = new SqliteConceptStore(db);
    const reader = new SqliteConceptReader(db);
    expect(reader.get('where')).toBeUndefined();
    await store.save(card({ topic: 'where' }), null);
    expect(reader.get('where')).toBeUndefined(); // cached miss
    reader.invalidate();
    expect(reader.get('where')?.title).toBe('GROUP BY');
  });

  it('a fixed set answers by topic', () => {
    expect(new StaticConcepts([card()]).get('group-by')?.nudge).toBe('Group rows.');
  });
});

describe('the shipped cards (16.1)', () => {
  const file = conceptFileSchema.parse(
    JSON.parse(
      readFileSync(
        fileURLToPath(new URL('../../../content/concepts/cards.json', import.meta.url)),
        'utf8',
      ),
    ),
  );

  it('are valid, unique, and cover every topic any question uses', () => {
    const topics = new Set(file.cards.map((c) => c.topic));
    expect(topics.size).toBe(file.cards.length);
    const used = new Set<string>();
    for (const tier of [1, 2, 3, 4, 5]) {
      const questions = JSON.parse(
        readFileSync(
          fileURLToPath(new URL(`../../../content/questions/tier-${tier}.json`, import.meta.url)),
          'utf8',
        ),
      ) as { questions: { topic: string[] }[] };
      for (const q of questions.questions) for (const t of q.topic) used.add(t);
    }
    expect([...used].filter((t) => !topics.has(t))).toEqual([]);
  });
});
