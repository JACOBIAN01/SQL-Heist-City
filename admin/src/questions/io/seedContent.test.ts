import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { ImportReport, QuestionSummary } from '@heist/shared';
import { startAdmin } from '../../testing/harness';

const dir = fileURLToPath(new URL('../../../../content/questions', import.meta.url));
const files = readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .sort();

type Harness = Awaited<ReturnType<typeof startAdmin>>;
let h: Harness | undefined;
afterEach(() => h?.close());

describe('seed content', () => {
  it('has the 150-question curriculum plus the task-kind sets, all importing cleanly', async () => {
    h = await startAdmin();
    await h.loginAs('a@school.test', 'admin');
    for (const file of files) {
      const body = readFileSync(`${dir}/${file}`, 'utf8');
      const res = await h.client.request<{ report: ImportReport }>(
        'POST',
        '/api/questions/import',
        body,
      );
      // tier-N.json: the 30-per-tier curriculum; kinds-*.json: the Phase 17 task-kind sets.
      expect(res.body.report.counts, file).toMatchObject({
        invalid: 0,
        ...(file.startsWith('tier-') ? { created: 30 } : {}),
      });
    }
    const all = (await h.client.get<{ questions: QuestionSummary[] }>('/api/questions')).body
      .questions;
    expect(all.length).toBeGreaterThanOrEqual(250);
    for (const tier of [1, 2, 3, 4, 5])
      expect(all.filter((q) => q.tier === tier).length).toBeGreaterThanOrEqual(30);
  }, 60_000);
});
