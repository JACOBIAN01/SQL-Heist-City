import { afterEach, describe, expect, it } from 'vitest';
import { questionTemplateSchema, type ImportReport, type QuestionDetail } from '@heist/shared';
import { sampleQuestion } from '@heist/shared/fixtures';
import { startAdmin } from '../../testing/harness';

type Harness = Awaited<ReturnType<typeof startAdmin>>;
let h: Harness | undefined;
afterEach(() => h?.close());

type Report = { report: ImportReport };

const q = (slug: string, extra: object = {}) => ({ ...sampleQuestion, slug, ...extra });

async function login() {
  h = await startAdmin();
  await h.loginAs('t@school.test');
  return h.client;
}

const listSlugs = async (client: Harness['client']) =>
  (await client.get<{ questions: { slug: string }[] }>('/api/questions')).body.questions.map(
    (x) => x.slug,
  );

describe('import', () => {
  it('imports valid questions and reports invalid ones per item', async () => {
    const client = await login();
    const body = {
      questions: [
        q('one'),
        q('two', { tier: 9 }),
        q('three', { reference_sql: 'SELECT nope FROM employees' }),
        q('one'),
      ],
    };
    const { report } = (await client.post<Report>('/api/questions/import', body)).body;
    expect(report.counts).toEqual({ created: 1, updated: 0, skipped: 0, invalid: 3 });
    expect(report.items.map((i) => [i.index, i.slug, i.status])).toEqual([
      [1, 'one', 'created'],
      [2, 'two', 'invalid'],
      [3, 'three', 'invalid'],
      [4, 'one', 'invalid'],
    ]);
    expect(report.items[1]?.errors?.[0]).toMatch(/^tier:/);
    expect(report.items[2]?.errors?.join(' ')).toMatch(/no such column/);
    expect(await listSlugs(client)).toEqual(['one']);
  });

  it('dry run validates without saving', async () => {
    const client = await login();
    const { report } = (
      await client.post<Report>('/api/questions/import?dryRun=true', [q('one'), q('two')])
    ).body;
    expect(report).toMatchObject({ dryRun: true, counts: { created: 2 } });
    expect(await listSlugs(client)).toEqual([]);
  });

  it('skips existing slugs by default, or updates them on request', async () => {
    const client = await login();
    await client.post('/api/questions', q('one'));
    const skip = (
      await client.post<Report>('/api/questions/import', [q('one', { title: 'Changed' })])
    ).body.report;
    expect(skip.counts.skipped).toBe(1);
    const upd = (
      await client.post<Report>('/api/questions/import?onConflict=update', [
        q('one', { title: 'Changed' }),
      ])
    ).body.report;
    expect(upd.counts.updated).toBe(1);
    const detail = await client.get<{ question: QuestionDetail }>('/api/questions/1');
    expect(detail.body.question).toMatchObject({ title: 'Changed', version: 2 });
  });

  it('rejects files that are not question lists', async () => {
    const client = await login();
    expect(await client.post('/api/questions/import', { nope: true })).toMatchObject({
      status: 400,
      body: { error: { code: 'bad_import_file' } },
    });
  });
});

describe('export → import round trip', () => {
  for (const format of ['json', 'csv'] as const) {
    it(`is lossless for ${format}`, async () => {
      const client = await login();
      const tricky = q('tricky', {
        title: 'Commas, "quotes" and\nnewlines',
        topic: ['select', 'where'],
        enabled: false,
        order_matters: true,
        hints: [{ text: 'Use, "AND"', cost: 0.1 }],
      });
      await client.post('/api/questions', tricky);
      await client.post('/api/questions', q('plain'));
      const exported = await client.get<string>(`/api/questions/export?format=${format}`);
      expect(exported.status).toBe(200);
      expect(exported.headers.get('content-disposition')).toMatch(
        new RegExp(`questions-.*\\.${format}`),
      );

      // Import into a fresh admin instance.
      await h?.close();
      const fresh = await login();
      const body = format === 'json' ? (exported.body as unknown) : (exported.body as string);
      const res = await fresh.request<Report>(
        'POST',
        '/api/questions/import',
        typeof body === 'string' ? body : JSON.stringify(body),
        { 'content-type': format === 'csv' ? 'text/csv' : 'application/json' },
      );
      expect(res.body.report.counts.created).toBe(2);
      const imported = await fresh.get<{ question: QuestionDetail }>('/api/questions/1');
      expect(imported.body.question.template).toEqual(questionTemplateSchema.parse(tricky));
    });
  }
});
