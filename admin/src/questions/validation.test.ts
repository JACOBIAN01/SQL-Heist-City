import { afterEach, describe, expect, it } from 'vitest';
import type { QuestionDetail } from '@heist/shared';
import { sampleQuestion } from '@heist/shared/fixtures';
import { startAdmin } from '../testing/harness';

type Harness = Awaited<ReturnType<typeof startAdmin>>;
let h: Harness | undefined;
afterEach(() => h?.close());

type Invalid = {
  error: { code: string; details: { seed: string; issues: string[]; error: string | null }[] };
};

describe('save-time validation', () => {
  it('refuses to create a question whose reference query fails', async () => {
    h = await startAdmin();
    await h.loginAs('t@school.test');
    const res = await h.client.post<Invalid>('/api/questions', {
      ...sampleQuestion,
      reference_sql: 'SELECT nope FROM employees',
    });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('question_invalid');
    expect(res.body.error.details).toHaveLength(5);
    expect(res.body.error.details[0]?.error).toMatch(/no such column/);
    expect(
      (await h.client.get<{ questions: unknown[] }>('/api/questions')).body.questions,
    ).toHaveLength(0);
  });

  it('refuses empty results unless allow_empty is set', async () => {
    h = await startAdmin();
    await h.loginAs('t@school.test');
    const empty = {
      ...sampleQuestion,
      reference_sql: 'SELECT name FROM employees WHERE salary < 0',
    };
    expect((await h.client.post('/api/questions', empty)).status).toBe(422);
    expect((await h.client.post('/api/questions', { ...empty, allow_empty: true })).status).toBe(
      201,
    );
  });

  it('refuses an update that breaks a saved question and keeps the old version', async () => {
    h = await startAdmin();
    await h.loginAs('t@school.test');
    const { id } = (
      await h.client.post<{ question: QuestionDetail }>('/api/questions', sampleQuestion)
    ).body.question;
    const res = await h.client.put(`/api/questions/${id}`, {
      ...sampleQuestion,
      reference_sql: 'SELECT 1 FROM nowhere',
    });
    expect(res.status).toBe(422);
    expect(
      (await h.client.get<{ question: QuestionDetail }>(`/api/questions/${id}`)).body.question
        .version,
    ).toBe(1);
  });
});
