import { afterAll, describe, expect, it } from 'vitest';
import { questionTemplateSchema } from '@heist/shared';
import { sampleQuestion } from '@heist/shared/fixtures';
import { builtInDatasets } from '../variants/datasets';
import { VariantBuilder } from '../variants/VariantBuilder';
import { Grader, ReferenceQueryError } from './Grader';
import { InProcessSandboxRunner } from './SandboxRunner';
import { WorkerSandboxRunner } from './WorkerSandboxRunner';

const template = questionTemplateSchema.parse(sampleQuestion);
const builder = new VariantBuilder(builtInDatasets);
const grader = new Grader(new InProcessSandboxRunner());

async function setup(seed = 'grader-seed') {
  const variant = builder.build(template, seed);
  return { variant, expected: await grader.expectedResult(variant) };
}

describe('Grader', () => {
  it('accepts the reference answer and equivalent rewrites', async () => {
    const { variant, expected } = await setup();
    const { dept, min_salary } = variant.params;
    const answers = [
      variant.referenceSql,
      `select e.name as who from employees e where e.salary > ${min_salary} and e.dept = '${dept}'`,
      `SELECT name FROM employees WHERE NOT (dept <> '${dept}' OR salary <= ${min_salary}) ORDER BY name DESC`,
      `WITH x AS (SELECT * FROM employees WHERE dept = '${dept}') SELECT name FROM x WHERE salary > ${min_salary};`,
    ];
    for (const sql of answers) {
      expect(await grader.grade(variant, expected, sql)).toEqual({ status: 'correct' });
    }
  });

  it('rejects wrong answers with a hint that leaks neither SQL nor data', async () => {
    const { variant, expected } = await setup();
    const { dept, min_salary } = variant.params;
    const wrong = [
      `SELECT name FROM employees WHERE dept = '${dept}' AND salary >= ${Number(min_salary) - 1000}`,
      `SELECT name, salary FROM employees WHERE dept = '${dept}' AND salary > ${min_salary}`,
      'SELECT name FROM employees',
    ];
    for (const sql of wrong) {
      const result = await grader.grade(variant, expected, sql);
      expect(result.status).toBe('wrong');
      if (result.status !== 'wrong') continue;
      expect(result.feedback.message).not.toContain(variant.referenceSql);
      for (const row of expected.rows)
        expect(result.feedback.message).not.toContain(String(row[0]));
    }
  });

  it("copying another player's answer fails (anti-copy)", async () => {
    const mine = await setup('player-a');
    const theirs = await setup('player-b');
    const copied = await grader.grade(mine.variant, mine.expected, theirs.variant.referenceSql);
    expect(copied.status).toBe('wrong');
  });

  it('reports student SQL errors and blocked statements as errors', async () => {
    const { variant, expected } = await setup();
    expect(await grader.grade(variant, expected, 'SELECT nme FROM employees')).toMatchObject({
      status: 'error',
      feedback: { code: 'sql_error' },
    });
    expect(await grader.grade(variant, expected, 'DELETE FROM employees')).toMatchObject({
      status: 'error',
      feedback: { code: 'not_a_query' },
    });
  });

  it('previews only a few rows', async () => {
    const { variant } = await setup();
    const preview = await grader.preview(variant, 'SELECT * FROM employees');
    expect(preview.status).toBe('ok');
    if (preview.status === 'ok') expect(preview.result.rows).toHaveLength(5);
  });

  it('throws ReferenceQueryError when the question itself is broken', async () => {
    const broken = builder.build({ ...template, reference_sql: 'SELECT nope FROM employees' }, 's');
    await expect(grader.expectedResult(broken)).rejects.toThrow(ReferenceQueryError);
    const empty = builder.build(
      { ...template, reference_sql: 'SELECT name FROM employees WHERE 0' },
      's',
    );
    await expect(grader.expectedResult(empty)).rejects.toThrow(/empty result/);
  });
});

describe('Grader with the worker pool', () => {
  const runner = new WorkerSandboxRunner({ size: 1, timeoutMs: 400 });
  const pooled = new Grader(runner);
  afterAll(() => runner.close());

  it('turns a runaway student query into a timeout error, not a crash', async () => {
    const variant = builder.build(template, 'timeout');
    const expected = await pooled.expectedResult(variant);
    const result = await pooled.grade(
      variant,
      expected,
      'WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n) SELECT COUNT(*) FROM n',
    );
    expect(result).toMatchObject({ status: 'error', feedback: { code: 'timeout' } });
    expect(await pooled.grade(variant, expected, variant.referenceSql)).toEqual({
      status: 'correct',
    });
  });
});
