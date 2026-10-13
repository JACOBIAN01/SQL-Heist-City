import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { questionTemplateSchema } from '@heist/shared';
import { sampleQuestion } from '@heist/shared/fixtures';
import { openDatabase } from '../db/database';
import { PgQuestionStore } from '../questions/PgQuestionStore';
import { SqliteQuestionRepository } from '../questions/SqliteQuestionRepository';
import { importSqlite } from './importSqlite';
import type { PgDatabase } from './PgDatabase';
import { TEST_DATABASE_URL, freshPg } from './testing';

describe.skipIf(!TEST_DATABASE_URL)('import from SQLite', () => {
  let pg: PgDatabase;
  let drop: () => Promise<void>;
  beforeAll(async () => ({ db: pg, drop } = await freshPg()));
  afterAll(() => drop());

  it('keeps ids, versions, users, pools and settings, and later rows continue after them', async () => {
    const src = openDatabase({ path: ':memory:' });
    const repo = new SqliteQuestionRepository(src);
    const base = questionTemplateSchema.parse(sampleQuestion);
    const a = repo.create({ ...base, slug: 'a', topic: ['joins'] }, 'ana');
    repo.update(a.id, { ...base, slug: 'a', title: 'Second' }, 'ana');
    const b = repo.create({ ...base, slug: 'b' }, 'ana');
    src
      .prepare("INSERT INTO users (email, password_hash, role) VALUES ('t@x.test', 'h', 'teacher')")
      .run();
    src.prepare("INSERT INTO pools (name) VALUES ('Week 1')").run();
    src.prepare('INSERT INTO pool_questions VALUES (1, ?)').run(b.id);
    src.prepare("INSERT INTO settings VALUES ('heist', '{\"killBonus\":9}')").run();
    src.prepare("INSERT INTO reward_map VALUES ('gun:rifle', 2, 3)").run();

    const counts = await importSqlite(src, pg);
    expect(counts).toMatchObject({
      questions: 2,
      question_versions: 3,
      users: 1,
      pools: 1,
      pool_questions: 1,
    });

    const store = new PgQuestionStore(pg);
    expect((await store.getBySlug('a'))?.version).toBe(2);
    expect((await store.versions(a.id)).map((v) => v.template.title)).toEqual([
      base.title,
      'Second',
    ]);
    expect((await store.getById(b.id))?.slug).toBe('b');
    expect((await pg.one<{ email: string }>('SELECT email FROM users'))?.email).toBe('t@x.test');
    expect(
      (
        await pg.one<{ value_json: { killBonus: number } }>(
          "SELECT value_json FROM settings WHERE key = 'heist'",
        )
      )?.value_json.killBonus,
    ).toBe(9);

    const c = await store.create({ ...base, slug: 'c' }, 'ana');
    expect(c.id).toBeGreaterThan(b.id);
  });

  it('refuses a target that already has data', async () => {
    await expect(importSqlite(openDatabase({ path: ':memory:' }), pg)).rejects.toThrow(/not empty/);
  });
});
