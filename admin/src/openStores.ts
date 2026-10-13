import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { openDatabase } from '@heist/server/db/database';
import { PgDatabase } from '@heist/server/pg/PgDatabase';
import { migratePg } from '@heist/server/pg/migrate';
import { pgStores, sqliteStores, type AdminStores } from './stores';

export interface OpenedStores {
  readonly stores: AdminStores;
  /** Where the data lives, for the start-up log (never the password). */
  readonly label: string;
  close(): Promise<void>;
}

/**
 * PostgreSQL when `DATABASE_URL` is set (the system of record), otherwise the
 * SQLite file at `sqlitePath` (development).
 */
export async function openStores(sqlitePath: string): Promise<OpenedStores> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const db = PgDatabase.open({ url });
    await migratePg(db);
    return {
      stores: pgStores(db),
      label: `postgres ${new URL(url).host}`,
      close: () => db.close(),
    };
  }
  mkdirSync(dirname(sqlitePath), { recursive: true });
  const db = openDatabase({ path: sqlitePath });
  return { stores: sqliteStores(db), label: sqlitePath, close: async () => db.close() };
}
