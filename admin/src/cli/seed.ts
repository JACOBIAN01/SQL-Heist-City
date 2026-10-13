import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStores } from '../openStores';
import { buildAdmin } from '../composition';
import { questionFormats } from '../questions/io/formats';

/**
 * Seeds a database with the content in content/questions/ through the same
 * import path teachers use (validation, versions, audit).
 *
 *   npm run db:seed                 → import new questions, skip existing slugs
 *   npm run db:seed -- --update     → also update existing questions from the files
 *
 * On an empty database, set ADMIN_EMAIL + ADMIN_PASSWORD to create the first admin.
 */
const update = process.argv.includes('--update');
const dbPath =
  process.env.DB_PATH ?? fileURLToPath(new URL('../../../data/dev.db', import.meta.url));
const contentDir = fileURLToPath(new URL('../../../content/questions', import.meta.url));

const opened = await openStores(dbPath);
const admin = buildAdmin(
  opened.stores,
  { secureCookies: false, sessionTtlMs: 0 },
  { error: (m, meta) => console.error(m, meta ?? '') },
);

await admin.auth.ensureInitialAdmin(process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD);
const actor = (await admin.auth.listUsers()).find((u) => u.role === 'admin' && !u.disabled);
if (!actor) {
  console.error('No admin account exists. Re-run with ADMIN_EMAIL and ADMIN_PASSWORD set.');
  process.exit(1);
}

let failed = 0;
for (const file of readdirSync(contentDir)
  .filter((f) => f.endsWith('.json'))
  .sort()) {
  const body = JSON.parse(readFileSync(join(contentDir, file), 'utf8')) as unknown;
  const report = await admin.io.import(
    questionFormats.json,
    body,
    { dryRun: false, onConflict: update ? 'update' : 'skip' },
    actor,
  );
  const { created, updated, skipped, invalid } = report.counts;
  console.log(
    `${file}: ${created} created, ${updated} updated, ${skipped} skipped, ${invalid} invalid`,
  );
  for (const item of report.items.filter((i) => i.status === 'invalid')) {
    console.log(`  ✗ ${item.slug}: ${item.errors?.join('; ')}`);
  }
  failed += invalid;
}

await admin.close();
await opened.close();
console.log(`seeded ${opened.label} as ${actor.email}`);
process.exit(failed > 0 ? 1 : 0);
