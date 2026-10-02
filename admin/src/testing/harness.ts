import type { Role } from '@heist/shared';
import { openDatabase } from '@heist/server/db/database';
import { ScryptPasswordHasher } from '../auth/PasswordHasher';
import { InProcessSandboxRunner } from '@heist/server/sql/SandboxRunner';
import { buildAdmin } from '../composition';
import { startTestServer } from './http';

export const TEST_PASSWORD = 'correct-horse-battery';

/** Full admin app on an in-memory DB, with a cheap hasher so tests stay fast. */
export async function startAdmin(
  options: { now?: () => number; gameServer?: { url: string; secret: string } } = {},
) {
  const db = openDatabase({ path: ':memory:' });
  const errors: string[] = [];
  const admin = buildAdmin(
    db,
    {
      secureCookies: false,
      sessionTtlMs: 60 * 60 * 1000,
      ...(options.gameServer ? { gameServer: options.gameServer } : {}),
    },
    { error: (m, meta) => errors.push(`${m} ${JSON.stringify(meta)}`) },
    {
      hasher: new ScryptPasswordHasher({ N: 1024, r: 8, p: 1, keylen: 32 }),
      sandbox: new InProcessSandboxRunner(),
      ...(options.now ? { now: options.now } : {}),
    },
  );
  const client = await startTestServer(admin.app);

  async function createUser(email: string, role: Role, password = TEST_PASSWORD) {
    return admin.auth.createUser(email, password, role);
  }

  async function loginAs(email: string, role: Role = 'teacher') {
    await createUser(email, role);
    const res = await client.post('/api/auth/login', { email, password: TEST_PASSWORD });
    if (res.status !== 200) throw new Error(`login failed: ${JSON.stringify(res.body)}`);
  }

  const close = async () => {
    await client.close();
    await admin.close();
  };
  return { db, admin, client, errors, createUser, loginAs, close };
}
