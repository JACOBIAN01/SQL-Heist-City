import { afterEach, describe, expect, it } from 'vitest';
import type { QuestionDetail } from '@heist/shared';
import { sampleQuestion } from '@heist/shared/fixtures';
import { startAdmin } from '../testing/harness';

type Harness = Awaited<ReturnType<typeof startAdmin>>;
let h: Harness | undefined;
afterEach(() => h?.close());

type One = { question: QuestionDetail };
type Versions = { versions: { version: number; createdBy: string; template: { title: string } }[] };

describe('question versions', () => {
  it('lists every version and rolls back by creating a new one', async () => {
    h = await startAdmin();
    await h.loginAs('t@school.test');
    const { id } = (await h.client.post<One>('/api/questions', sampleQuestion)).body.question;
    await h.client.put(`/api/questions/${id}`, { ...sampleQuestion, title: 'Second' });
    await h.client.put(`/api/questions/${id}`, { ...sampleQuestion, title: 'Third' });

    const rolled = await h.client.post<One>(`/api/questions/${id}/rollback/1`);
    expect(rolled.body.question).toMatchObject({ version: 4, title: sampleQuestion.title });

    const versions = await h.client.get<Versions>(`/api/questions/${id}/versions`);
    expect(versions.body.versions.map((v) => [v.version, v.template.title, v.createdBy])).toEqual([
      [1, sampleQuestion.title, 't@school.test'],
      [2, 'Second', 't@school.test'],
      [3, 'Third', 't@school.test'],
      [4, sampleQuestion.title, 't@school.test'],
    ]);
  });

  it('404s for unknown versions and questions', async () => {
    h = await startAdmin();
    await h.loginAs('t@school.test');
    const { id } = (await h.client.post<One>('/api/questions', sampleQuestion)).body.question;
    expect((await h.client.post(`/api/questions/${id}/rollback/7`)).status).toBe(404);
    expect((await h.client.get('/api/questions/99/versions')).status).toBe(404);
  });
});
