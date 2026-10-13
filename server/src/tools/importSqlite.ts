import { fileURLToPath } from 'node:url';
import { openDatabase } from '../db/database';
import { PgDatabase } from '../pg/PgDatabase';
import { importSqlite } from '../pg/importSqlite';
import { migratePg } from '../pg/migrate';

// npm run db:import-sqlite — copies data/dev.db (or DB_PATH) into the empty PostgreSQL at DATABASE_URL.
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}
const path = process.env.DB_PATH ?? fileURLToPath(new URL('../../../data/dev.db', import.meta.url));
const pg = PgDatabase.open({ url, max: 1 });
try {
  await migratePg(pg);
  const counts = await importSqlite(openDatabase({ path, readOnly: true }), pg);
  console.log(`imported ${path}:`, counts);
} finally {
  await pg.close();
}
