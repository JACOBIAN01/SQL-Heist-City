import { describe, expect, it } from 'vitest';
import { sampleQuestion } from '@heist/shared/fixtures';
import { Grader } from '@heist/server/sql/Grader';
import { InProcessSandboxRunner } from '@heist/server/sql/SandboxRunner';
import { builtInDatasets } from '@heist/server/variants/datasets';
import { VariantBuilder } from '@heist/server/variants/VariantBuilder';
import { ContentValidator } from './ContentValidator';
import { QuestionTester } from './QuestionTester';

const validator = new ContentValidator(
  new QuestionTester(new VariantBuilder(builtInDatasets), new Grader(new InProcessSandboxRunner())),
  { seeds: 10, minDifferentAnswerRate: 0.95, slowMs: 1000 },
);

describe('ContentValidator', () => {
  it('passes good content and counts tiers', async () => {
    const report = await validator.validate([
      { name: 't1.json', data: { questions: [sampleQuestion] } },
    ]);
    expect(report).toEqual({ questions: 1, byTier: { 1: 1 }, problems: [] });
  });

  it('reports schema errors, duplicate slugs, failing seeds and shareable answers', async () => {
    const constantAnswer = {
      ...sampleQuestion,
      slug: 'constant',
      params: {},
      story_md: 'How many tables are there?',
      reference_sql: 'SELECT 1',
    };
    const report = await validator.validate([
      { name: 'a.json', data: [sampleQuestion, { ...sampleQuestion, tier: 9 }] },
      {
        name: 'b.json',
        data: [
          sampleQuestion,
          { ...sampleQuestion, slug: 'broken', reference_sql: 'SELECT nope FROM employees' },
          constantAnswer,
        ],
      },
      { name: 'c.json', data: { nope: true } },
    ]);
    const messages = report.problems.map((p) => `${p.file}:${p.slug}:${p.message}`);
    expect(messages).toEqual([
      expect.stringMatching(/^a\.json:emp-high-earners-dept:tier:/),
      'b.json:emp-high-earners-dept:duplicate slug (also in a.json)',
      expect.stringMatching(/^b\.json:broken:10\/10 seeds fail — qa-1: .*no such column/),
      expect.stringMatching(/^b\.json:constant:100% of player pairs get the same answer/),
      'c.json:null:not a question list',
    ]);
  });
});
