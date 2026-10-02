import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '@heist/server/db/database';
import { buildAdmin } from './composition';

// Entry point: reads the environment, then delegates wiring to buildAdmin().
const port = Number(process.env.PORT ?? 8081);
const dbPath = process.env.DB_PATH ?? fileURLToPath(new URL('../../data/dev.db', import.meta.url));
const logger = {
  error: (message: string, meta?: Record<string, unknown>) => console.error(message, meta ?? ''),
};

mkdirSync(dirname(dbPath), { recursive: true });
const db = openDatabase({ path: dbPath });
const admin = buildAdmin(
  db,
  {
    secureCookies: process.env.NODE_ENV === 'production',
    sessionTtlMs: 12 * 60 * 60 * 1000,
    uiDistDir: fileURLToPath(new URL('../ui/dist', import.meta.url)),
  },
  logger,
);

const created = await admin.auth.ensureInitialAdmin(
  process.env.ADMIN_EMAIL,
  process.env.ADMIN_PASSWORD,
);
if (created) console.log(`created initial admin ${created.email}`);

admin.app.listen(port, () => {
  console.log(`admin listening on http://localhost:${port} (db: ${dbPath})`);
});
