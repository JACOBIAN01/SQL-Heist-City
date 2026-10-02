import { afterEach, describe, expect, it } from 'vitest';
import type { QuestionDetail, QuestionSummary } from '@heist/shared';
import { sampleQuestion } from '@heist/shared/fixtures';
import type { AdminEvent } from '../events/AdminEvents';
import { startAdmin } from '../testing/harness';

type Harness = Awaited<ReturnType<typeof startAdmin>>;
let h: Harness | undefined;
afterEach(() => h?.close());

async function asTeacher() {
  h = await startAdmin();
  await h.loginAs('t@school.test', 'teacher');
  const events: AdminEvent[] = [];
  h.admin.events.subscribe((e) => events.push(e));
  return { h, client: h.client, events };
}

type One = { question: QuestionDetail };
type Many = { questions: QuestionSummary[] };

describe('questions API', () => {
  it('requires login', async () => {
    h = await startAdmin();
    expect((await h.client.get('/api/questions')).status).toBe(401);
  });

  it('creates, reads, updates and lists', async () => {
    const { client, events } = await asTeacher();
    const created = await client.post<One>('/api/questions', sampleQuestion);
    expect(created.status).toBe(201);
    const id = created.body.question.id;
    expect(created.body.question).toMatchObject({
      slug: sampleQuestion.slug,
      version: 1,
      enabled: true,
    });

    const updated = await client.put<One>(`/api/questions/${id}`, {
      ...sampleQuestion,
      title: 'Renamed',
    });
    expect(updated.body.question).toMatchObject({ title: 'Renamed', version: 2 });
    expect((await client.get<One>(`/api/questions/${id}`)).body.question.template.title).toBe(
      'Renamed',
    );

    const list = await client.get<Many>('/api/questions');
    expect(list.body.questions).toEqual([
      expect.objectContaining({ id, title: 'Renamed', topics: ['select', 'where'] }),
    ]);
    expect(events.map((e) => (e.type === 'question_changed' ? e.action : e.type))).toEqual([
      'create',
      'update',
    ]);
    const update = events[1];
    expect(update?.type === 'question_changed' && update.actor.email).toBe('t@school.test');
  });

  it('rejects invalid templates with field paths', async () => {
    const { client } = await asTeacher();
    const res = await client.post('/api/questions', {
      ...sampleQuestion,
      tier: 9,
      story_md: 'Find {ghost}',
    });
    expect(res.status).toBe(400);
    const paths = (res.body as { error: { details: { path: string }[] } }).error.details.map(
      (d) => d.path,
    );
    expect(paths).toEqual(expect.arrayContaining(['tier']));
  });

  it('rejects duplicate slugs with 409', async () => {
    const { client } = await asTeacher();
    await client.post('/api/questions', sampleQuestion);
    expect((await client.post('/api/questions', sampleQuestion)).status).toBe(409);
  });

  it('filters by tier, enabled, topic and search', async () => {
    const { client } = await asTeacher();
    await client.post('/api/questions', {
      ...sampleQuestion,
      slug: 'a-join',
      title: 'Join the vault',
      tier: 3,
      topic: ['joins'],
    });
    await client.post('/api/questions', {
      ...sampleQuestion,
      slug: 'b-where',
      tier: 1,
      enabled: false,
    });
    const slugs = async (qs: string) =>
      (await client.get<Many>(`/api/questions?${qs}`)).body.questions.map((q) => q.slug);
    expect(await slugs('tier=3')).toEqual(['a-join']);
    expect(await slugs('enabled=false')).toEqual(['b-where']);
    expect(await slugs('topic=joins')).toEqual(['a-join']);
    expect(await slugs('q=VAULT')).toEqual(['a-join']);
    expect((await client.get('/api/questions?tier=9')).status).toBe(400);
  });

  it('enables, disables and duplicates', async () => {
    const { client } = await asTeacher();
    const { id } = (await client.post<One>('/api/questions', sampleQuestion)).body.question;
    expect((await client.post<One>(`/api/questions/${id}/disable`)).body.question.enabled).toBe(
      false,
    );
    expect((await client.post<One>(`/api/questions/${id}/enable`)).body.question.enabled).toBe(
      true,
    );
    const copy = await client.post<One>(`/api/questions/${id}/duplicate`);
    const copy2 = await client.post<One>(`/api/questions/${id}/duplicate`);
    expect(copy.body.question).toMatchObject({
      slug: `${sampleQuestion.slug}-copy`,
      enabled: false,
      version: 1,
    });
    expect(copy2.body.question.slug).toBe(`${sampleQuestion.slug}-copy-2`);
  });

  it('only admins can delete; deleted questions disappear', async () => {
    const { h: harness, client } = await asTeacher();
    const { id } = (await client.post<One>('/api/questions', sampleQuestion)).body.question;
    expect((await client.del(`/api/questions/${id}`)).status).toBe(403);
    client.clearCookie();
    await harness.loginAs('a@school.test', 'admin');
    expect((await client.del(`/api/questions/${id}`)).status).toBe(204);
    expect((await client.get(`/api/questions/${id}`)).status).toBe(404);
  });
});
