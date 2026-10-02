import { DatabaseSync } from 'node:sqlite';
import { migrations as defaultMigrations } from './migrations';

export interface OpenDatabaseOptions {
  /** File path, or ':memory:' for tests. */
  path: string;
  readOnly?: boolean;
  migrations?: readonly string[];
}

/**
 * Opens the persistent question/config database and brings its schema up to
 * date. The game server opens it read-only; the admin service writes.
 */
export function openDatabase(options: OpenDatabaseOptions): DatabaseSync {
  const db = new DatabaseSync(options.path, {
    readOnly: options.readOnly ?? false,
    enableForeignKeyConstraints: true,
    timeout: 5_000,
  });
  if (!options.readOnly) {
    if (options.path !== ':memory:') {
      // WAL lets the game server read while the admin writes (system-design.md §14).
      db.exec('PRAGMA journal_mode = WAL');
    }
    migrate(db, options.migrations ?? defaultMigrations);
  }
  return db;
}

/** Applies pending migrations in one transaction each; returns the new schema version. */
export function migrate(db: DatabaseSync, migrations: readonly string[]): number {
  let version = schemaVersion(db);
  if (version > migrations.length) {
    throw new Error(
      `database schema v${version} is newer than this code (v${migrations.length}); refusing to run`,
    );
  }
  for (; version < migrations.length; version++) {
    db.exec('BEGIN');
    try {
      db.exec(migrations[version] as string);
      db.exec(`PRAGMA user_version = ${version + 1}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw new Error(`migration ${version + 1} failed: ${(err as Error).message}`, { cause: err });
    }
  }
  return version;
}

export function schemaVersion(db: DatabaseSync): number {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number };
  return row.user_version;
}
