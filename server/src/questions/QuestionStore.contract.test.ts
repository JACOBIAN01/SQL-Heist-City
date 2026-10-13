import { afterAll, describe, expect, it } from 'vitest';
import { questionTemplateSchema, type QuestionTemplate } from '@heist/shared';
import { sampleQuestion } from '@heist/shared/fixtures';
import { openDatabase } from '../db/database';
import { TEST_DATABASE_URL, freshPg } from '../pg/testing';
import { InMemoryQuestionRepository } from './InMemoryQuestionRepository';
import { PgQuestionStore } from './PgQuestionStore';
import { DuplicateSlugError, QuestionNotFoundError } from './QuestionRepository';
import { SqliteQuestionRepository } from './SqliteQuestionRepository';
import { SyncQuestionStore, type QuestionStore } from './QuestionStore';

// SOLID: L (Liskov) — Why: SQLite, the in-memory fake and PostgreSQL all run the same suite, so
// moving the system of record to PostgreSQL cannot change what a question store does.
const drops: (() => Promise<void>)[] = [];
afterAll(() => Promise.all(drops.map((d) => d())));

const implementations: [string, () => Promise<QuestionStore>][] = [
  [
    'SyncQuestionStore(Sqlite)',
    async () =>
      new SyncQuestionStore(new SqliteQuestionRepository(openDatabase({ path: ':memory:' }))),
  ],
  [
    'SyncQuestionStore(InMemory)',
    async () => new SyncQuestionStore(new InMemoryQuestionRepository()),
  ],
  ...(TEST_DATABASE_URL
    ? [
        [
          'PgQuestionStore',
          async () => {
            const { db, drop } = await freshPg();
            drops.push(drop);
            return new PgQuestionStore(db);
          },
        ] as [string, () => Promise<QuestionStore>],
      ]
    : []),
];

const base = questionTemplateSchema.parse(sampleQuestion);
const question = (overrides: Partial<QuestionTemplate> = {}): QuestionTemplate => ({
  ...base,
  ...overrides,
});

describe.each(implementations)('%s', (_name, make) => {
  it('creates and reads back a question at version 1', async () => {
    const repo = await make();
    const created = await repo.create(question(), 'teacher@school');
    expect(created).toMatchObject({ slug: base.slug, version: 1, enabled: true });
    expect((await repo.getById(created.id))?.template).toEqual(base);
    expect((await repo.getBySlug(base.slug))?.id).toBe(created.id);
  });

  it('rejects duplicate slugs', async () => {
    const repo = await make();
    await repo.create(question(), null);
    await expect(repo.create(question(), null)).rejects.toThrow(DuplicateSlugError);
  });

  it('keeps every version on update', async () => {
    const repo = await make();
    const { id } = await repo.create(question(), 'a');
    const updated = await repo.update(id, question({ title: 'New title' }), 'b');
    expect(updated.version).toBe(2);
    expect(updated.template.title).toBe('New title');
    expect(
      (await repo.versions(id)).map((v) => [v.version, v.template.title, v.createdBy]),
    ).toEqual([
      [1, base.title, 'a'],
      [2, 'New title', 'b'],
    ]);
  });

  it('rejects renaming to a slug that is taken', async () => {
    const repo = await make();
    await repo.create(question({ slug: 'one' }), null);
    const { id } = await repo.create(question({ slug: 'two' }), null);
    await expect(repo.update(id, question({ slug: 'one' }), null)).rejects.toThrow(
      DuplicateSlugError,
    );
  });

  it('filters by tier, enabled and topic', async () => {
    const repo = await make();
    await repo.create(question({ slug: 't1', tier: 1, topic: ['where'] }), null);
    await repo.create(question({ slug: 't3', tier: 3, topic: ['joins'] }), null);
    const off = await repo.create(question({ slug: 't3-off', tier: 3, topic: ['joins'] }), null);
    await repo.setEnabled(off.id, false, null);

    const slugs = async (f: Parameters<QuestionStore['list']>[0]) =>
      (await repo.list(f)).map((q) => q.slug);
    expect(await slugs({})).toEqual(['t1', 't3', 't3-off']);
    expect(await slugs({ tierMin: 2 })).toEqual(['t3', 't3-off']);
    expect(await slugs({ tierMax: 2 })).toEqual(['t1']);
    expect(await slugs({ enabled: true, topic: 'joins' })).toEqual(['t3']);
  });

  it('setEnabled is a no-op when unchanged and versions when changed', async () => {
    const repo = await make();
    const { id } = await repo.create(question(), null);
    expect((await repo.setEnabled(id, true, null)).version).toBe(1);
    expect(await repo.setEnabled(id, false, null)).toMatchObject({ version: 2, enabled: false });
  });

  it('soft-deletes: hidden from reads, slug stays reserved', async () => {
    const repo = await make();
    const { id } = await repo.create(question(), null);
    await repo.remove(id, null);
    expect(await repo.getById(id)).toBeUndefined();
    expect(await repo.list()).toEqual([]);
    await expect(repo.update(id, question(), null)).rejects.toThrow(QuestionNotFoundError);
    await expect(repo.create(question(), null)).rejects.toThrow(DuplicateSlugError);
  });

  it('rejects with QuestionNotFoundError for unknown ids', async () => {
    const repo = await make();
    await expect(repo.versions(42)).rejects.toThrow(QuestionNotFoundError);
  });
});

describe.skipIf(!TEST_DATABASE_URL)('PgQuestionStore specifics', () => {
  it('rolls back a failed create (no orphan rows)', async () => {
    const { db, drop } = await freshPg();
    try {
      const repo = new PgQuestionStore(db);
      await repo.create(question(), null);
      await expect(repo.create(question(), null)).rejects.toThrow();
      const row = await db.one<{ n: string }>('SELECT count(*) AS n FROM question_versions');
      expect(row?.n).toBe('1');
    } finally {
      await drop();
    }
  });
});
