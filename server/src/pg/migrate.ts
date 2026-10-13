import type { PgDatabase } from './PgDatabase';
import { pgMigrations } from './migrations';

/** Arbitrary but fixed: one migrator at a time across every process. */
const LOCK_KEY = 7_315_001;

/**
 * Applies pending migrations, each in its own transaction, and returns the
 * version reached. Safe to start from several processes at once.
 */
export async function migratePg(
  db: PgDatabase,
  migrations: readonly string[] = pgMigrations,
): Promise<number> {
  return db.tx(async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock($1)', [LOCK_KEY]);
    await tx.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         version    INTEGER PRIMARY KEY,
         applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
       )`,
    );
    const row = await tx.one<{ v: number | null }>(
      'SELECT max(version) AS v FROM schema_migrations',
    );
    let version = row?.v ?? 0;
    if (version > migrations.length) {
      throw new Error(
        `database schema v${version} is newer than this code (v${migrations.length}); refusing to run`,
      );
    }
    for (; version < migrations.length; version++) {
      try {
        await tx.query(migrations[version] as string);
      } catch (err) {
        throw new Error(`migration ${version + 1} failed: ${(err as Error).message}`, {
          cause: err,
        });
      }
      await tx.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version + 1]);
    }
    return version;
  });
}
