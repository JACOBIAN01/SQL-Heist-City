import type { QuestionTemplateInput } from '@heist/shared';

/**
 * Editor form state. Nested generator specs are edited as JSON text, so the
 * draft keeps them as strings until save.
 */
export interface Draft {
  slug: string;
  title: string;
  tier: number;
  topics: string;
  enabled: boolean;
  story_md: string;
  schema_sql: string;
  reference_sql: string;
  data_gen: string;
  params: string;
  order_matters: boolean;
  allow_empty: boolean;
  compare_names: boolean;
  compare_case: boolean;
  hints: { text: string; cost: number }[];
}

export const STARTER_TEMPLATE: QuestionTemplateInput = {
  slug: 'new-question',
  tier: 1,
  topic: ['select'],
  title: 'New question',
  story_md: 'List the names of accounts with a balance above **{min_balance}**.',
  schema_sql: 'CREATE TABLE accounts (id INTEGER PRIMARY KEY, owner TEXT, balance INTEGER);',
  data_gen: {
    accounts: {
      rows: [20, 40],
      columns: {
        id: { kind: 'serial' },
        owner: { kind: 'pick', from: 'first_names' },
        balance: { kind: 'int', min: 0, max: 10000, step: 50 },
      },
    },
  },
  params: { min_balance: { kind: 'int', min: 2000, max: 6000, step: 500 } },
  reference_sql: 'SELECT owner FROM accounts WHERE balance > {min_balance};',
  hints: [{ text: 'Filter rows with WHERE.', cost: 0.05 }],
  enabled: false,
};

export function toDraft(t: QuestionTemplateInput): Draft {
  return {
    slug: t.slug,
    title: t.title,
    tier: t.tier,
    topics: t.topic.join(', '),
    enabled: t.enabled ?? true,
    story_md: t.story_md,
    schema_sql: t.schema_sql,
    reference_sql: t.reference_sql,
    data_gen: JSON.stringify(t.data_gen, null, 2),
    params: JSON.stringify(t.params ?? {}, null, 2),
    order_matters: t.order_matters ?? false,
    allow_empty: t.allow_empty ?? false,
    compare_names: t.compare?.names ?? false,
    compare_case: t.compare?.case ?? true,
    hints: (t.hints ?? []).map((h) => ({ text: h.text, cost: h.cost })),
  };
}

export type DraftResult =
  { ok: true; template: QuestionTemplateInput } | { ok: false; errors: string[] };

/** Builds the API payload; JSON syntax errors are reported per field. */
export function fromDraft(d: Draft): DraftResult {
  const errors: string[] = [];
  const parseJson = (field: string, text: string): unknown => {
    try {
      return JSON.parse(text);
    } catch (err) {
      errors.push(`${field}: invalid JSON (${(err as Error).message})`);
      return undefined;
    }
  };
  const dataGen = parseJson('data_gen', d.data_gen);
  const params = parseJson('params', d.params);
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    template: {
      slug: d.slug.trim(),
      title: d.title.trim(),
      tier: d.tier,
      topic: d.topics
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
      enabled: d.enabled,
      story_md: d.story_md,
      schema_sql: d.schema_sql,
      reference_sql: d.reference_sql,
      data_gen: dataGen as QuestionTemplateInput['data_gen'],
      params: params as QuestionTemplateInput['params'],
      order_matters: d.order_matters,
      allow_empty: d.allow_empty,
      compare: { names: d.compare_names, case: d.compare_case },
      hints: d.hints.filter((h) => h.text.trim() !== ''),
    },
  };
}
