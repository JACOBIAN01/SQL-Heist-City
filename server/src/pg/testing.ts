import { randomUUID } from 'node:crypto';
import { PgDatabase, quoteIdent } from './PgDatabase';
import { migratePg } from './migrate';

/** The database tests may use, or undefined (then PostgreSQL tests are skipped). */
export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

/**
 * A fresh, migrated PostgreSQL schema for one test file. `drop` removes it.
 * Each file gets its own schema, so files run in parallel without touching each other.
 */
export async function freshPg(): Promise<{ db: PgDatabase; drop: () => Promise<void> }> {
  if (!TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL is not set');
  const schema = `t_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
  const admin = PgDatabase.open({ url: TEST_DATABASE_URL, max: 1 });
  await admin.query(`CREATE SCHEMA ${quoteIdent(schema)}`);
  const db = PgDatabase.open({ url: TEST_DATABASE_URL, schema });
  await migratePg(db);
  return {
    db,
    drop: async () => {
      await db.close();
      await admin.query(`DROP SCHEMA ${quoteIdent(schema)} CASCADE`);
      await admin.close();
    },
  };
}
