import { describe, expect, it } from 'vitest';
import { questionTemplateSchema } from '@heist/shared';
import { sampleQuestion } from '@heist/shared/fixtures';
import { STARTER_TEMPLATE, fromDraft, toDraft } from './draft';

describe('draft', () => {
  it('round-trips a template through the form state', () => {
    const result = fromDraft(toDraft(sampleQuestion));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(questionTemplateSchema.parse(result.template)).toEqual(
        questionTemplateSchema.parse(sampleQuestion),
      );
    }
  });

  it('reports invalid JSON per field', () => {
    const draft = { ...toDraft(sampleQuestion), data_gen: '{ nope', params: '[' };
    const result = fromDraft(draft);
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.errors.map((e) => e.split(':')[0])).toEqual(['data_gen', 'params']);
  });

  it('splits topics and drops empty hints', () => {
    const result = fromDraft({
      ...toDraft(sampleQuestion),
      topics: ' joins , ,where',
      hints: [{ text: ' ', cost: 0 }],
    });
    expect(result.ok && result.template.topic).toEqual(['joins', 'where']);
    expect(result.ok && result.template.hints).toEqual([]);
  });

  it('starter template is valid', () => {
    expect(questionTemplateSchema.safeParse(STARTER_TEMPLATE).success).toBe(true);
  });

  it('keeps the task and the story themes through an edit', () => {
    const themed = {
      ...sampleQuestion,
      task: { kind: 'fix' as const, broken_sql: 'SELEC 1' },
      themes: [{ name: 'casino', tables: { employees: 'croupiers' } }],
    };
    const result = fromDraft(toDraft(themed));
    expect(result.ok && result.template.task).toEqual(themed.task);
    expect(result.ok && result.template.themes).toEqual(themed.themes);
  });
});
