import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createUserSchema } from '@heist/shared';
import { openDatabase } from '@heist/server/db/database';
import { ScryptPasswordHasher } from '../auth/PasswordHasher';
import { SqliteUserRepository } from '../auth/UserRepository';

/**
 * Creates (or resets the password of) an admin/teacher account directly in
 * the database. Works while the admin server is running.
 *
 *   npm run user:create -w @heist/admin -- --email you@school.test --password '…' [--role admin]
 */
const { values } = parseArgs({
  options: {
    email: { type: 'string' },
    password: { type: 'string' },
    role: { type: 'string', default: 'admin' },
  },
});

const parsed = createUserSchema.safeParse(values);
if (!parsed.success) {
  for (const issue of parsed.error.issues)
    console.error(`${issue.path.join('.')}: ${issue.message}`);
  console.error(
    "usage: npm run user:create -w @heist/admin -- --email you@school.test --password '…' [--role admin|teacher]",
  );
  process.exit(1);
}

const dbPath =
  process.env.DB_PATH ?? fileURLToPath(new URL('../../../data/dev.db', import.meta.url));
mkdirSync(dirname(dbPath), { recursive: true });
const users = new SqliteUserRepository(openDatabase({ path: dbPath }));
const passwordHash = await new ScryptPasswordHasher().hash(parsed.data.password);
const existing = users.findByEmail(parsed.data.email);
if (existing) {
  users.update(existing.id, { passwordHash, role: parsed.data.role, disabled: false });
  console.log(`updated ${parsed.data.email} (${parsed.data.role}) in ${dbPath}`);
} else {
  users.create({ email: parsed.data.email, passwordHash, role: parsed.data.role });
  console.log(`created ${parsed.data.email} (${parsed.data.role}) in ${dbPath}`);
}
