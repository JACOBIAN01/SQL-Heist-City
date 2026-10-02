import { afterEach, describe, expect, it } from 'vitest';
import type { AuditEntry, QuestionDetail } from '@heist/shared';
import { sampleQuestion } from '@heist/shared/fixtures';
import { startAdmin, TEST_PASSWORD } from '../testing/harness';
import { changedFields } from './AuditLog';

type Harness = Awaited<ReturnType<typeof startAdmin>>;
let h: Harness | undefined;
afterEach(() => h?.close());

type Entries = { entries: AuditEntry[] };

describe('audit log', () => {
  it('records question changes with actor and changed fields, newest first', async () => {
    h = await startAdmin();
    await h.loginAs('a@school.test', 'admin');
    const { id } = (
      await h.client.post<{ question: QuestionDetail }>('/api/questions', sampleQuestion)
    ).body.question;
    await h.client.put(`/api/questions/${id}`, { ...sampleQuestion, title: 'New', tier: 2 });
    await h.client.post(`/api/questions/${id}/disable`);

    const { entries } = (await h.client.get<Entries>(`/api/audit?entity=question&entityId=${id}`))
      .body;
    expect(entries.map((e) => e.action)).toEqual(['disable', 'update', 'create']);
    expect(entries[1]).toMatchObject({
      actor: 'a@school.test',
      detail: { changed: ['tier', 'title'] },
    });
  });

  it('records user changes without passwords', async () => {
    h = await startAdmin();
    await h.loginAs('a@school.test', 'admin');
    const created = await h.client.post<{ user: { id: number } }>('/api/users', {
      email: 'new@school.test',
      password: TEST_PASSWORD,
      role: 'teacher',
    });
    await h.client.put(`/api/users/${created.body.user.id}`, { password: 'another-long-password' });
    const { entries } = (await h.client.get<Entries>('/api/audit?entity=user')).body;
    expect(entries.map((e) => e.action)).toEqual(['update', 'create']);
    expect(JSON.stringify(entries)).not.toContain('another-long-password');
    expect(JSON.stringify(entries)).not.toContain(TEST_PASSWORD);
  });

  it('is admin-only and pages with before/limit', async () => {
    h = await startAdmin();
    await h.loginAs('a@school.test', 'admin');
    for (let i = 0; i < 3; i++)
      await h.client.post('/api/questions', { ...sampleQuestion, slug: `q-${i}` });
    const page1 = (await h.client.get<Entries>('/api/audit?limit=2')).body.entries;
    const page2 = (await h.client.get<Entries>(`/api/audit?limit=2&before=${page1[1]?.id}`)).body
      .entries;
    expect(page1).toHaveLength(2);
    expect(page2).toHaveLength(1);
    h.client.clearCookie();
    await h.loginAs('t@school.test', 'teacher');
    expect((await h.client.get('/api/audit')).status).toBe(403);
  });
});

describe('changedFields', () => {
  it('lists changed top-level keys', () => {
    expect(changedFields({ a: 1, b: [1], c: 3 }, { a: 1, b: [2], d: 4 })).toEqual(['b', 'c', 'd']);
  });
});
