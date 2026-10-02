import { describe, expect, it } from 'vitest';
import { questionTemplateSchema } from '@heist/shared';
import { sampleQuestion } from '@heist/shared/fixtures';
import { builtInDatasets } from './datasets';
import { renderTemplate, sqlLiteral } from './render';
import { VariantBuilder } from './VariantBuilder';

const template = questionTemplateSchema.parse(sampleQuestion);
const builder = new VariantBuilder(builtInDatasets);

describe('VariantBuilder', () => {
  it('builds the same variant for the same seed', () => {
    expect(builder.build(template, 'p1')).toEqual(builder.build(template, 'p1'));
  });

  it('two seeds give two different variants (anti-copy)', () => {
    const a = builder.build(template, 'player-a');
    const b = builder.build(template, 'player-b');
    expect(a.tables).not.toEqual(b.tables);
    expect([a.story, a.referenceSql]).not.toEqual([b.story, b.referenceSql]);
  });

  it('renders params into story and reference SQL', () => {
    const v = builder.build(template, 'render');
    const { dept, min_salary } = v.params;
    expect(v.story).toBe(
      `List the names of employees in **${dept}** who earn more than **${min_salary}**.`,
    );
    expect(v.referenceSql).toBe(
      `SELECT name FROM employees WHERE dept = '${dept}' AND salary > ${min_salary};`,
    );
  });

  it('carries grading flags from the template', () => {
    const v = builder.build({ ...template, order_matters: true, allow_empty: true }, 's');
    expect(v).toMatchObject({
      orderMatters: true,
      allowEmpty: true,
      compare: { names: false, case: true },
    });
  });
});

describe('render helpers', () => {
  it('escapes quotes in SQL string literals', () => {
    expect(sqlLiteral("O'Brien")).toBe("'O''Brien'");
    expect(sqlLiteral(42)).toBe('42');
    expect(sqlLiteral(true)).toBe('1');
  });

  it('renders plain and sql formats differently', () => {
    expect(renderTemplate('{n} / {n|sql} / {b}', { n: "it's", b: false })).toBe(
      "it's / 'it''s' / no",
    );
  });
});
