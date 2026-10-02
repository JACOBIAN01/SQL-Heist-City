import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CachedSettingsReader } from './config/CachedSettingsReader';
import { SqliteSettingsReader } from './config/SettingsReader';
import { openDatabase } from './db/database';
import { createHttpServer } from './http/httpServer';
import { CachedQuestionReader } from './questions/CachedQuestionReader';
import { SqliteQuestionRepository } from './questions/SqliteQuestionRepository';

// Composition root: the only place that wires concrete dependencies.
const port = Number(process.env.PORT ?? 8080);
const dbPath = process.env.DB_PATH ?? fileURLToPath(new URL('../../data/dev.db', import.meta.url));

// The admin service owns the schema; the game only reads. Until the admin has
// created the database there is nothing to cache (the game loop comes later).
const caches: { invalidate(): void }[] = [];
if (existsSync(dbPath)) {
  const db = openDatabase({ path: dbPath, readOnly: true });
  caches.push(new CachedQuestionReader(new SqliteQuestionRepository(db)));
  caches.push(new CachedSettingsReader(new SqliteSettingsReader(db)));
} else {
  console.warn(`no database at ${dbPath} yet — start the admin first to create it`);
}

const server = createHttpServer({
  now: Date.now,
  startedAt: Date.now(),
  ...(process.env.INTERNAL_SECRET ? { internalSecret: process.env.INTERNAL_SECRET } : {}),
  onReload: () => {
    for (const cache of caches) cache.invalidate();
    console.log('reloaded questions and settings');
  },
});

server.listen(port, () => {
  console.log(`game server listening on http://localhost:${port}`);
});
