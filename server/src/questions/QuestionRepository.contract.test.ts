import { describe, expect, it } from 'vitest';
import { questionTemplateSchema, type QuestionTemplate } from '@heist/shared';
import { sampleQuestion } from '@heist/shared/fixtures';
import { openDatabase } from '../db/database';
import { InMemoryQuestionRepository } from './InMemoryQuestionRepository';
import {
  DuplicateSlugError,
  QuestionNotFoundError,
  type QuestionRepository,
} from './QuestionRepository';
import { SqliteQuestionRepository } from './SqliteQuestionRepository';

// SOLID: L (Liskov) — Why: every implementation runs the same suite, so the
// in-memory fake used in other tests is guaranteed to behave like SQLite.
const implementations: [string, () => QuestionRepository][] = [
  [
    'SqliteQuestionRepository',
    () => new SqliteQuestionRepository(openDatabase({ path: ':memory:' })),
  ],
  ['InMemoryQuestionRepository', () => new InMemoryQuestionRepository()],
];

const base = questionTemplateSchema.parse(sampleQuestion);
function question(overrides: Partial<QuestionTemplate> = {}): QuestionTemplate {
  return { ...base, ...overrides };
}

describe.each(implementations)('%s', (_name, make) => {
  it('creates and reads back a question at version 1', () => {
    const repo = make();
    const created = repo.create(question(), 'teacher@school');
    expect(created).toMatchObject({ slug: base.slug, version: 1, enabled: true });
    expect(repo.getById(created.id)?.template).toEqual(base);
    expect(repo.getBySlug(base.slug)?.id).toBe(created.id);
  });

  it('rejects duplicate slugs', () => {
    const repo = make();
    repo.create(question(), null);
    expect(() => repo.create(question(), null)).toThrow(DuplicateSlugError);
  });

  it('keeps every version on update', () => {
    const repo = make();
    const { id } = repo.create(question(), 'a');
    const updated = repo.update(id, question({ title: 'New title' }), 'b');
    expect(updated.version).toBe(2);
    expect(updated.template.title).toBe('New title');
    expect(repo.versions(id).map((v) => [v.version, v.template.title, v.createdBy])).toEqual([
      [1, base.title, 'a'],
      [2, 'New title', 'b'],
    ]);
  });

  it('rejects renaming to a slug that is taken', () => {
    const repo = make();
    repo.create(question({ slug: 'one' }), null);
    const { id } = repo.create(question({ slug: 'two' }), null);
    expect(() => repo.update(id, question({ slug: 'one' }), null)).toThrow(DuplicateSlugError);
  });

  it('filters by tier, enabled and topic', () => {
    const repo = make();
    repo.create(question({ slug: 't1', tier: 1, topic: ['where'] }), null);
    repo.create(question({ slug: 't3', tier: 3, topic: ['joins'] }), null);
    const off = repo.create(question({ slug: 't3-off', tier: 3, topic: ['joins'] }), null);
    repo.setEnabled(off.id, false, null);

    const slugs = (f: Parameters<QuestionRepository['list']>[0]) => repo.list(f).map((q) => q.slug);
    expect(slugs({})).toEqual(['t1', 't3', 't3-off']);
    expect(slugs({ tierMin: 2 })).toEqual(['t3', 't3-off']);
    expect(slugs({ tierMax: 2 })).toEqual(['t1']);
    expect(slugs({ enabled: true, topic: 'joins' })).toEqual(['t3']);
  });

  it('setEnabled is a no-op when unchanged and versions when changed', () => {
    const repo = make();
    const { id } = repo.create(question(), null);
    expect(repo.setEnabled(id, true, null).version).toBe(1);
    expect(repo.setEnabled(id, false, null)).toMatchObject({ version: 2, enabled: false });
  });

  it('soft-deletes: hidden from reads, slug stays reserved', () => {
    const repo = make();
    const { id } = repo.create(question(), null);
    repo.remove(id, null);
    expect(repo.getById(id)).toBeUndefined();
    expect(repo.list()).toEqual([]);
    expect(() => repo.update(id, question(), null)).toThrow(QuestionNotFoundError);
    expect(() => repo.create(question(), null)).toThrow(DuplicateSlugError);
  });

  it('throws QuestionNotFoundError for unknown ids', () => {
    const repo = make();
    expect(() => repo.versions(42)).toThrow(QuestionNotFoundError);
  });
});

describe('SqliteQuestionRepository specifics', () => {
  it('rolls back a failed create (no orphan rows)', () => {
    const db = openDatabase({ path: ':memory:' });
    const repo = new SqliteQuestionRepository(db);
    repo.create(question(), null);
    expect(() => repo.create(question(), null)).toThrow();
    const count = db.prepare('SELECT COUNT(*) AS n FROM question_versions').get() as { n: number };
    expect(count.n).toBe(1);
  });
});
