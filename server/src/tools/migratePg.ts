import { PgDatabase } from '../pg/PgDatabase';
import { migratePg } from '../pg/migrate';

// npm run db:migrate — brings the PostgreSQL schema (DATABASE_URL) up to date.
const url = process.env.DATABASE_URL;
if (!url) {
  console.error(
    'DATABASE_URL is not set (for development: node scripts/pg-dev.mjs start, then use the url it prints)',
  );
  process.exit(1);
}
const db = PgDatabase.open({ url, max: 1 });
try {
  console.log(`schema at version ${await migratePg(db)}`);
} finally {
  await db.close();
}
