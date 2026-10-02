import { describe, expect, it } from 'vitest';
import { sampleQuestion } from './fixtures';
import { placeholderNames, questionTemplateSchema, type QuestionTemplateInput } from './template';

function parse(overrides: Partial<QuestionTemplateInput>) {
  return questionTemplateSchema.safeParse({ ...sampleQuestion, ...overrides });
}

function messages(result: ReturnType<typeof parse>): string[] {
  return result.success ? [] : result.error.issues.map((i) => i.message);
}

describe('questionTemplateSchema', () => {
  it('accepts the documented sample and fills defaults', () => {
    const q = questionTemplateSchema.parse(sampleQuestion);
    expect(q.order_matters).toBe(false);
    expect(q.compare).toEqual({ names: false, case: true });
    expect(q.allow_empty).toBe(false);
    expect(q.enabled).toBe(true);
    const id = q.data_gen.employees?.columns.id;
    expect(id).toEqual({ kind: 'serial', start: 1 });
  });

  it('rejects placeholders with no matching param', () => {
    const r = parse({ story_md: 'Find {missing}' });
    expect(messages(r)).toContain('placeholder {missing} has no matching entry in params');
  });

  it('rejects foreign keys to tables generated later', () => {
    const r = parse({
      data_gen: {
        accounts: { rows: 5, columns: { owner_id: { kind: 'fk', table: 'owners', column: 'id' } } },
        owners: { rows: 5, columns: { id: { kind: 'serial' } } },
      },
    });
    expect(messages(r)[0]).toMatch(/fk owners\.id must reference/);
  });

  it('accepts foreign keys to earlier tables', () => {
    const r = parse({
      data_gen: {
        owners: { rows: 5, columns: { id: { kind: 'serial' } } },
        accounts: { rows: 5, columns: { owner_id: { kind: 'fk', table: 'owners', column: 'id' } } },
      },
    });
    expect(r.success).toBe(true);
  });

  it.each([
    ['non-kebab slug', { slug: 'Bad Slug' }],
    ['tier out of range', { tier: 6 }],
    ['no topics', { topic: [] }],
    ['unsafe table name', { data_gen: { 'x; DROP': { rows: 1, columns: {} } } }],
    ['inverted row range', { data_gen: { t: { rows: [9, 2], columns: {} } } }],
    [
      'inverted int range',
      { data_gen: { t: { rows: 1, columns: { n: { kind: 'int', min: 5, max: 1 } } } } },
    ],
    [
      'weights length mismatch',
      {
        data_gen: {
          t: { rows: 1, columns: { c: { kind: 'pick', from: ['a', 'b'], weights: [1] } } },
        },
      },
    ],
  ] as const)('rejects %s', (_label, overrides) => {
    expect(parse(overrides as Partial<QuestionTemplateInput>).success).toBe(false);
  });
});

describe('placeholderNames', () => {
  it('finds plain and |sql placeholders', () => {
    expect(placeholderNames('a {x} b {y|sql} {x}')).toEqual(['x', 'y', 'x']);
  });
});
