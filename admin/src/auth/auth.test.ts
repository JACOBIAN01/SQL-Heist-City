import { afterEach, describe, expect, it } from 'vitest';
import { startAdmin, TEST_PASSWORD } from '../testing/harness';
import { LoginRateLimiter } from './LoginRateLimiter';
import { ScryptPasswordHasher } from './PasswordHasher';
import { readCookie } from './middleware';

type Harness = Awaited<ReturnType<typeof startAdmin>>;
let h: Harness | undefined;
afterEach(() => h?.close());

describe('auth API', () => {
  it('logs in, reports the user, and logs out', async () => {
    h = await startAdmin();
    await h.createUser('teacher@school.test', 'teacher');
    const login = await h.client.post('/api/auth/login', {
      email: 'Teacher@School.test',
      password: TEST_PASSWORD,
    });
    expect(login.status).toBe(200);
    expect(login.body).toMatchObject({ user: { email: 'teacher@school.test', role: 'teacher' } });
    const cookie = login.headers.get('set-cookie') ?? '';
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(JSON.stringify(login.body)).not.toMatch(/password/i);

    expect(await h.client.get('/api/auth/me')).toMatchObject({
      status: 200,
      body: { user: { role: 'teacher' } },
    });
    expect((await h.client.post('/api/auth/logout')).status).toBe(204);
    expect((await h.client.get('/api/auth/me')).status).toBe(401);
  });

  it('logging out revokes the session server-side', async () => {
    h = await startAdmin();
    await h.loginAs('t@school.test');
    const n = () => (h?.db.prepare('SELECT COUNT(*) AS n FROM sessions').get() as { n: number }).n;
    expect(n()).toBe(1);
    await h.client.post('/api/auth/logout');
    expect(n()).toBe(0);
  });

  it('rejects wrong passwords and unknown emails the same way', async () => {
    h = await startAdmin();
    await h.createUser('t@school.test', 'teacher');
    const wrong = await h.client.post('/api/auth/login', {
      email: 't@school.test',
      password: 'nope-nope-nope',
    });
    const unknown = await h.client.post('/api/auth/login', {
      email: 'x@school.test',
      password: 'nope-nope-nope',
    });
    expect(wrong).toMatchObject({ status: 401, body: { error: { code: 'invalid_credentials' } } });
    expect(unknown.body).toEqual(wrong.body);
  });

  it('refuses disabled users', async () => {
    h = await startAdmin();
    const user = await h.createUser('t@school.test', 'teacher');
    h.db.prepare('UPDATE users SET disabled = 1 WHERE id = ?').run(user.id);
    expect(
      (await h.client.post('/api/auth/login', { email: 't@school.test', password: TEST_PASSWORD }))
        .status,
    ).toBe(401);
  });

  it('blocks after repeated failures', async () => {
    h = await startAdmin();
    await h.createUser('t@school.test', 'teacher');
    for (let i = 0; i < 5; i++)
      await h.client.post('/api/auth/login', {
        email: 't@school.test',
        password: 'bad-password-x',
      });
    const blocked = await h.client.post('/api/auth/login', {
      email: 't@school.test',
      password: TEST_PASSWORD,
    });
    expect(blocked).toMatchObject({ status: 429, body: { error: { code: 'too_many_attempts' } } });
  });

  it('requires the CSRF header on mutating requests', async () => {
    h = await startAdmin();
    await h.createUser('t@school.test', 'teacher');
    const res = await h.client.request(
      'POST',
      '/api/auth/login',
      { email: 't@school.test', password: TEST_PASSWORD },
      {
        'x-heist-admin': '',
      },
    );
    expect(res).toMatchObject({ status: 403, body: { error: { code: 'csrf' } } });
  });

  it('expires sessions after the TTL', async () => {
    let now = 1_000_000;
    h = await startAdmin({ now: () => now });
    await h.loginAs('t@school.test');
    now += 60 * 60 * 1000;
    expect((await h.client.get('/api/auth/me')).status).toBe(401);
  });

  it('validates the login body', async () => {
    h = await startAdmin();
    expect(
      await h.client.post('/api/auth/login', { email: 'not-an-email', password: '' }),
    ).toMatchObject({
      status: 400,
      body: { error: { code: 'validation_failed' } },
    });
  });

  it('creates the initial admin only when there are no users', async () => {
    h = await startAdmin();
    expect(await h.admin.auth.ensureInitialAdmin('root@school.test', TEST_PASSWORD)).toMatchObject({
      role: 'admin',
    });
    expect(
      await h.admin.auth.ensureInitialAdmin('other@school.test', TEST_PASSWORD),
    ).toBeUndefined();
  });
});

describe('ScryptPasswordHasher', () => {
  const hasher = new ScryptPasswordHasher({ N: 1024, r: 8, p: 1, keylen: 32 });

  it('verifies the right password only, with a unique salt per hash', async () => {
    const a = await hasher.hash('s3cret-pass');
    const b = await hasher.hash('s3cret-pass');
    expect(a).not.toBe(b);
    expect(await hasher.verify('s3cret-pass', a)).toBe(true);
    expect(await hasher.verify('wrong', a)).toBe(false);
    expect(await hasher.verify('x', 'garbage')).toBe(false);
  });
});

describe('LoginRateLimiter', () => {
  it('unblocks after the window and resets on success', () => {
    let now = 0;
    const limiter = new LoginRateLimiter(2, 1000, () => now);
    limiter.recordFailure('k');
    limiter.recordFailure('k');
    expect(limiter.blockedUntil('k')).toBe(1000);
    now = 1001;
    expect(limiter.blockedUntil('k')).toBeUndefined();
    limiter.recordFailure('k');
    limiter.reset('k');
    expect(limiter.blockedUntil('k')).toBeUndefined();
  });
});

describe('readCookie', () => {
  it('finds a cookie among others', () => {
    expect(readCookie('a=1; heist_session=abc%3D; b=2', 'heist_session')).toBe('abc=');
    expect(readCookie(undefined, 'x')).toBeUndefined();
  });
});
