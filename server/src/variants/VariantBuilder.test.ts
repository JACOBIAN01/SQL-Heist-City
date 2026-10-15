import { describe, expect, it } from 'vitest';
import { questionTemplateSchema } from '@heist/shared';
import { sampleQuestion } from '@heist/shared/fixtures';
import { Grader } from '../sql/Grader';
import { InProcessSandboxRunner } from '../sql/SandboxRunner';
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

describe('VariantBuilder: story themes (17.12)', () => {
  const plain = questionTemplateSchema.parse({
    ...sampleQuestion,
    story_md:
      'List the **name** of employees in **{dept}** earning over **{min_salary}** at the bank.',
  });
  const themed = questionTemplateSchema.parse({
    ...plain,
    themes: [
      {
        name: 'casino',
        title: 'Croupier Leak',
        tables: { employees: 'croupiers' },
        columns: { salary: 'wage', dept: 'floor' },
        words: { employees: 'croupiers', bank: 'casino' },
      },
    ],
  });
  const builder = new VariantBuilder(builtInDatasets);
  const grader = new Grader(new InProcessSandboxRunner());

  it('gives some players each theme, with the same params, data and right answer', async () => {
    const seen = new Set<string>();
    for (let i = 0; i < 12; i++) {
      const seed = `theme-${i}`;
      const a = builder.build(plain, seed);
      const b = builder.build(themed, seed);
      seen.add(b.theme?.name ?? 'plain');
      expect(b.params).toEqual(a.params);
      expect([...b.tables.values()].map((t) => t.rows)).toEqual(
        [...a.tables.values()].map((t) => t.rows),
      );
      expect((await grader.expectedResult(b)).rows).toEqual((await grader.expectedResult(a)).rows);
      if (b.theme) {
        expect(b.title).toBe('Croupier Leak');
        expect(b.story).toContain('croupiers');
        expect(b.story).toContain('casino');
        expect(b.schemaSql).toContain('CREATE TABLE croupiers');
        expect([...b.tables.keys()]).toEqual(['croupiers']);
        expect(b.tables.get('croupiers')?.columns).toContain('wage');
        // The plain query no longer fits; the themed one does.
        expect(
          (await grader.grade(b, await grader.expectedResult(b), a.referenceSql)).status,
        ).not.toBe('correct');
        expect((await grader.grade(b, await grader.expectedResult(b), b.referenceSql)).status).toBe(
          'correct',
        );
      }
    }
    expect(seen).toEqual(new Set(['plain', 'casino']));
  });

  it('refuses themes that rename what is not there or clash with a name in use', () => {
    const bad = (theme: object) =>
      questionTemplateSchema.safeParse({ ...plain, themes: [{ name: 'x', ...theme }] }).success;
    expect(bad({ tables: { nope: 'x' } })).toBe(false);
    expect(bad({ columns: { nope: 'x' } })).toBe(false);
    expect(bad({ columns: { salary: 'name' } })).toBe(false);
    expect(bad({ columns: { salary: 'wage' } })).toBe(true);
  });
});
