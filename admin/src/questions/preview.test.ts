import { afterEach, describe, expect, it } from 'vitest';
import type { PreviewReport, QuestionDetail } from '@heist/shared';
import { sampleQuestion } from '@heist/shared/fixtures';
import { startAdmin } from '../testing/harness';

type Harness = Awaited<ReturnType<typeof startAdmin>>;
let h: Harness | undefined;
afterEach(() => h?.close());

type Report = { report: PreviewReport };

async function withQuestion() {
  h = await startAdmin();
  await h.loginAs('t@school.test');
  const { id } = (
    await h.client.post<{ question: QuestionDetail }>('/api/questions', sampleQuestion)
  ).body.question;
  return { client: h.client, id };
}

describe('question preview', () => {
  it('runs the reference on each seed and shows story, data and expected rows', async () => {
    const { client, id } = await withQuestion();
    const { report } = (
      await client.post<Report>(`/api/questions/${id}/preview`, { seeds: ['a', 'b', 'c', 'd'] })
    ).body;
    expect(report.ok).toBe(true);
    expect(report.seeds.map((s) => s.seed)).toEqual(['a', 'b', 'c', 'd']);
    const first = report.seeds[0];
    expect(first?.story).toMatch(/^List the names of employees in/);
    expect(first?.referenceSql).toMatch(/^SELECT name FROM employees WHERE dept = '/);
    expect(first?.tables?.[0]?.name).toBe('employees');
    expect(first?.expected?.columns).toEqual(['name']);
    expect(report.differentAnswerRate).toBeGreaterThan(0.5);
  });

  it('grades a student query against every seed', async () => {
    const { client, id } = await withQuestion();
    const { report } = (
      await client.post<Report>(`/api/questions/${id}/preview`, {
        studentSql: 'SELECT name FROM employees',
      })
    ).body;
    expect(report.seeds.every((s) => s.student?.status === 'wrong')).toBe(true);
  });

  it('previews an unsaved draft and flags its problems', async () => {
    h = await startAdmin();
    await h.loginAs('t@school.test');
    const draft = {
      ...sampleQuestion,
      reference_sql: 'SELECT name FROM employees WHERE salary < 0',
    };
    const { report } = (await h.client.post<Report>('/api/questions/preview', { template: draft }))
      .body;
    expect(report.ok).toBe(false);
    expect(report.seeds.every((s) => s.issues.includes('empty'))).toBe(true);

    const broken = { ...sampleQuestion, reference_sql: 'SELECT nope FROM employees' };
    const r2 = (await h.client.post<Report>('/api/questions/preview', { template: broken })).body
      .report;
    expect(r2.seeds[0]).toMatchObject({ issues: ['error'] });
    expect(r2.seeds[0]?.error).toMatch(/no such column/);
  });

  it('reports data generation errors (unknown dataset)', async () => {
    h = await startAdmin();
    await h.loginAs('t@school.test');
    const draft = {
      ...sampleQuestion,
      data_gen: {
        employees: { rows: 5, columns: { name: { kind: 'pick', from: 'no_such_dataset' } } },
      },
    };
    const { report } = (await h.client.post<Report>('/api/questions/preview', { template: draft }))
      .body;
    expect(report.seeds[0]?.error).toMatch(/unknown dataset/);
  });

  it('rejects invalid drafts with 400', async () => {
    h = await startAdmin();
    await h.loginAs('t@school.test');
    expect(
      (await h.client.post('/api/questions/preview', { template: { slug: 'x' } })).status,
    ).toBe(400);
  });
});
