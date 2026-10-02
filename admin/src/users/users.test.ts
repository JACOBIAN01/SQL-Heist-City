import { afterEach, describe, expect, it } from 'vitest';
import { startAdmin, TEST_PASSWORD } from '../testing/harness';

type Harness = Awaited<ReturnType<typeof startAdmin>>;
let h: Harness | undefined;
afterEach(() => h?.close());

describe('role guard', () => {
  it('anonymous → 401, teacher → 403, admin → 200', async () => {
    h = await startAdmin();
    expect((await h.client.get('/api/users')).status).toBe(401);
    await h.loginAs('t@school.test', 'teacher');
    expect(await h.client.get('/api/users')).toMatchObject({
      status: 403,
      body: { error: { code: 'forbidden' } },
    });
    h.client.clearCookie();
    await h.loginAs('a@school.test', 'admin');
    expect((await h.client.get('/api/users')).status).toBe(200);
  });
});

describe('user management (admin)', () => {
  it('creates users and rejects duplicates and weak passwords', async () => {
    h = await startAdmin();
    await h.loginAs('a@school.test', 'admin');
    const created = await h.client.post('/api/users', {
      email: 'New@School.test',
      password: TEST_PASSWORD,
      role: 'teacher',
    });
    expect(created).toMatchObject({
      status: 201,
      body: { user: { email: 'new@school.test', role: 'teacher' } },
    });
    expect(
      (
        await h.client.post('/api/users', {
          email: 'new@school.test',
          password: TEST_PASSWORD,
          role: 'teacher',
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await h.client.post('/api/users', {
          email: 'x@school.test',
          password: 'short',
          role: 'teacher',
        })
      ).status,
    ).toBe(400);
    const list = await h.client.get<{ users: { email: string }[] }>('/api/users');
    expect(list.body.users.map((u) => u.email)).toEqual(['a@school.test', 'new@school.test']);
    expect(JSON.stringify(list.body)).not.toMatch(/hash/i);
  });

  it('disabling a user signs them out', async () => {
    h = await startAdmin();
    const teacher = await h.createUser('t@school.test', 'teacher');
    await h.client.post('/api/auth/login', { email: 't@school.test', password: TEST_PASSWORD });
    const teacherSessions = () =>
      (
        h?.db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?').get(teacher.id) as {
          n: number;
        }
      ).n;
    expect(teacherSessions()).toBe(1);
    h.client.clearCookie();
    await h.loginAs('a@school.test', 'admin');
    expect(await h.client.put(`/api/users/${teacher.id}`, { disabled: true })).toMatchObject({
      status: 200,
      body: { user: { disabled: true } },
    });
    expect(teacherSessions()).toBe(0);
  });

  it("admins can't disable or demote themselves", async () => {
    h = await startAdmin();
    await h.loginAs('a@school.test', 'admin');
    const me = await h.client.get<{ user: { id: number } }>('/api/auth/me');
    expect((await h.client.put(`/api/users/${me.body.user.id}`, { role: 'teacher' })).status).toBe(
      400,
    );
    expect((await h.client.put(`/api/users/${me.body.user.id}`, { disabled: true })).status).toBe(
      400,
    );
  });

  it('validates ids and unknown users', async () => {
    h = await startAdmin();
    await h.loginAs('a@school.test', 'admin');
    expect((await h.client.put('/api/users/abc', { role: 'admin' })).status).toBe(400);
    expect((await h.client.put('/api/users/999', { role: 'admin' })).status).toBe(404);
  });
});
