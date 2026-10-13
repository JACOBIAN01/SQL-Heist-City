import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PgDatabase } from './PgDatabase';
import { isUniqueViolation, quoteIdent } from './PgDatabase';
import { migratePg } from './migrate';
import { pgMigrations } from './migrations';
import { TEST_DATABASE_URL, freshPg } from './testing';

describe('quoteIdent', () => {
  it('quotes plain names and refuses anything else', () => {
    expect(quoteIdent('t_abc')).toBe('"t_abc"');
    expect(() => quoteIdent('x"; DROP')).toThrow();
  });
});

describe.skipIf(!TEST_DATABASE_URL)('PgDatabase and migrations', () => {
  let db: PgDatabase;
  let drop: () => Promise<void>;
  beforeAll(async () => ({ db, drop } = await freshPg()));
  afterAll(() => drop());

  it('builds an empty database from the migrations and records the version', async () => {
    const tables = await db.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = $1`,
      [db.schema],
    );
    const names = tables.map((t) => t.table_name);
    for (const t of ['questions', 'settings', 'users', 'sessions', 'audit_log', 'pools'])
      expect(names).toContain(t);
    expect(await migratePg(db)).toBe(pgMigrations.length); // running again changes nothing
  });

  it('refuses a database newer than the code', async () => {
    await db.query('INSERT INTO schema_migrations (version) VALUES ($1)', [999]);
    await expect(migratePg(db)).rejects.toThrow(/newer than this code/);
    await db.query('DELETE FROM schema_migrations WHERE version = 999');
  });

  it('rolls a transaction back when the work throws', async () => {
    await expect(
      db.tx(async (tx) => {
        await tx.query(`INSERT INTO settings (key, value_json) VALUES ('x', '1')`);
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await db.one(`SELECT 1 FROM settings WHERE key = 'x'`)).toBeUndefined();
  });

  it('recognises a unique violation', async () => {
    await db.query(`INSERT INTO settings (key, value_json) VALUES ('dup', '1')`);
    const err = await db
      .query(`INSERT INTO settings (key, value_json) VALUES ('dup', '2')`)
      .catch((e: unknown) => e);
    expect(isUniqueViolation(err)).toBe(true);
  });
});
