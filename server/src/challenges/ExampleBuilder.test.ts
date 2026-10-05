import { describe, expect, it } from 'vitest';
import { questionTemplateSchema } from '@heist/shared';
import { sampleQuestion } from '@heist/shared/fixtures';
import { Grader } from '../sql/Grader';
import { InProcessSandboxRunner } from '../sql/SandboxRunner';
import { builtInDatasets } from '../variants/datasets';
import { VariantBuilder } from '../variants/VariantBuilder';
import { ExampleBuilder } from './ExampleBuilder';

const template = questionTemplateSchema.parse(sampleQuestion);
const variants = new VariantBuilder(builtInDatasets);
const grader = new Grader(new InProcessSandboxRunner());
const examples = new ExampleBuilder(variants, grader);
const options = { rows: 6, tries: 3 };

describe('ExampleBuilder', () => {
  it('asks the same question as the real variant, on other, smaller data', async () => {
    const seed = 'm|p1|heal:small|1';
    const real = variants.build(template, seed);
    const example = variants.buildExample(template, seed, `${seed}/example-1`, 6);
    expect(example.params).toEqual(real.params);
    expect(example.referenceSql).toBe(real.referenceSql);
    expect(example.tables.get('employees')?.rows).toHaveLength(6);
    expect(example.tables.get('employees')?.rows).not.toEqual(
      real.tables.get('employees')?.rows.slice(0, 6),
    );
  });

  it('finds an example with rows, and the same one every time for a seed', async () => {
    for (const seed of ['a', 'b', 'c', 'd']) {
      const one = await examples.build(template, seed, options);
      const two = await examples.build(template, seed, options);
      expect(one?.found).toBe(true);
      expect(one?.output.rows.length).toBeGreaterThan(0);
      expect(one?.output).toEqual(two?.output);
    }
  });

  it('cannot be copied as the answer: its rows written out as literals are graded wrong', async () => {
    const seed = 'm|p1|heal:small|1';
    const example = await examples.build(template, seed, options);
    const rows = example?.output.rows ?? [];
    const literal = rows.map((r) => `SELECT '${String(r[0])}' AS name`).join(' UNION ALL ');
    const real = variants.build(template, seed);
    const grade = await grader.grade(real, await grader.expectedResult(real), literal);
    expect(grade.status).not.toBe('correct');
  });

  it('falls back to full-size data when small tables never answer', async () => {
    // One employee per try cannot be both in IT and over 8,000; full-size data can.
    const strict = questionTemplateSchema.parse({
      ...sampleQuestion,
      params: {
        dept: { kind: 'pick', from: ['IT'] },
        min_salary: { kind: 'int', min: 8000, max: 8000 },
      },
    });
    const found = [];
    for (const seed of ['a', 'b', 'c', 'd', 'e']) {
      const example = await examples.build(strict, seed, { rows: 1, tries: 1 });
      if (example?.found) found.push(example.tables.get('employees')?.rows.length ?? 0);
    }
    expect(found.length).toBeGreaterThan(0);
    expect(Math.max(...found)).toBeGreaterThan(1);
  });
});
