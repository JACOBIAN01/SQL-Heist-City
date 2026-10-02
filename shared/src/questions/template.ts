import { z } from 'zod';

/**
 * Question template: the import/export + storage format for one SQL question.
 * Field names are snake_case because this is the documented JSON format
 * teachers edit (docs/questions.md).
 */

export const MIN_TIER = 1;
export const MAX_TIER = 5;

/** SQL identifier we are willing to generate tables/columns for. */
const identifier = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'must be a plain SQL identifier (letters, digits, _)');

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');

/** A list of values, or the name of a shared dataset (e.g. "first_names"). */
const pickSource = z.union([z.array(z.union([z.string(), z.number()])).min(1), identifier]);

const nullRate = z.number().min(0).max(1).optional();

// --- Column generators (table data) -----------------------------------------

export const columnSpecSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('serial'), start: z.number().int().default(1) }),
  z.object({
    kind: z.literal('pick'),
    from: pickSource,
    weights: z.array(z.number().positive()).optional(),
    null_rate: nullRate,
  }),
  z.object({
    kind: z.literal('int'),
    min: z.number().int(),
    max: z.number().int(),
    step: z.number().int().positive().default(1),
    null_rate: nullRate,
  }),
  z.object({
    kind: z.literal('real'),
    min: z.number(),
    max: z.number(),
    decimals: z.number().int().min(0).max(6).default(2),
    null_rate: nullRate,
  }),
  z.object({ kind: z.literal('date'), from: isoDate, to: isoDate, null_rate: nullRate }),
  z.object({
    kind: z.literal('bool'),
    p: z.number().min(0).max(1).default(0.5),
    null_rate: nullRate,
  }),
  z.object({
    kind: z.literal('text_pattern'),
    /** `#` → digit, `@` → uppercase letter, anything else literal. e.g. "ACC-####". */
    pattern: z.string().min(1),
    unique: z.boolean().default(false),
    null_rate: nullRate,
  }),
  z.object({
    kind: z.literal('fk'),
    table: identifier,
    column: identifier,
    null_rate: nullRate,
  }),
  z.object({ kind: z.literal('const'), value: z.union([z.string(), z.number(), z.null()]) }),
]);

export const tableSpecSchema = z.object({
  /** Exact row count, or [min, max] inclusive. */
  rows: z.union([
    z.number().int().min(0).max(1000),
    z.tuple([z.number().int().min(0), z.number().int().max(1000)]),
  ]),
  columns: z.record(identifier, columnSpecSchema),
});

// --- Story/reference parameters ---------------------------------------------

export const paramSpecSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('pick'), from: pickSource }),
  z.object({
    kind: z.literal('int'),
    min: z.number().int(),
    max: z.number().int(),
    step: z.number().int().positive().default(1),
  }),
  z.object({ kind: z.literal('date'), from: isoDate, to: isoDate }),
  z.object({ kind: z.literal('bool'), p: z.number().min(0).max(1).default(0.5) }),
]);

export const hintSchema = z.object({
  text: z.string().min(1),
  cost: z.number().min(0),
});

/** `{name}` or `{name|sql}` placeholders in story/reference text. */
export const PLACEHOLDER_PATTERN = /\{([A-Za-z_][A-Za-z0-9_]*)(?:\|(sql))?\}/g;

export function placeholderNames(text: string): string[] {
  return [...text.matchAll(PLACEHOLDER_PATTERN)].map((m) => m[1] as string);
}

export const questionTemplateSchema = z
  .object({
    slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be kebab-case'),
    tier: z.number().int().min(MIN_TIER).max(MAX_TIER),
    topic: z.array(z.string().min(1)).min(1),
    title: z.string().min(1).max(120),
    story_md: z.string().min(1),
    schema_sql: z.string().min(1),
    data_gen: z.record(identifier, tableSpecSchema),
    params: z.record(identifier, paramSpecSchema).default({}),
    reference_sql: z.string().min(1),
    order_matters: z.boolean().default(false),
    compare: z
      .object({ names: z.boolean().default(false), case: z.boolean().default(true) })
      .default({ names: false, case: true }),
    allow_empty: z.boolean().default(false),
    hints: z.array(hintSchema).default([]),
    enabled: z.boolean().default(true),
  })
  .superRefine((q, ctx) => {
    for (const field of ['story_md', 'reference_sql'] as const) {
      for (const name of placeholderNames(q[field])) {
        if (!(name in q.params)) {
          ctx.addIssue({
            code: 'custom',
            path: [field],
            message: `placeholder {${name}} has no matching entry in params`,
          });
        }
      }
    }

    // Foreign keys may only point at tables generated earlier (generation order = key order).
    const seen = new Map<string, Set<string>>();
    for (const [table, spec] of Object.entries(q.data_gen)) {
      for (const [column, col] of Object.entries(spec.columns)) {
        if (col.kind === 'fk' && !seen.get(col.table)?.has(col.column)) {
          ctx.addIssue({
            code: 'custom',
            path: ['data_gen', table, 'columns', column],
            message: `fk ${col.table}.${col.column} must reference a column of an earlier table`,
          });
        }
      }
      seen.set(table, new Set(Object.keys(spec.columns)));
    }

    for (const [table, spec] of Object.entries(q.data_gen)) {
      if (Array.isArray(spec.rows) && spec.rows[0] > spec.rows[1]) {
        ctx.addIssue({ code: 'custom', path: ['data_gen', table, 'rows'], message: 'min > max' });
      }
      for (const [column, col] of Object.entries(spec.columns)) {
        if ((col.kind === 'int' || col.kind === 'real') && col.min > col.max) {
          ctx.addIssue({
            code: 'custom',
            path: ['data_gen', table, 'columns', column],
            message: 'min > max',
          });
        }
        if (
          col.kind === 'pick' &&
          col.weights &&
          Array.isArray(col.from) &&
          col.weights.length !== col.from.length
        ) {
          ctx.addIssue({
            code: 'custom',
            path: ['data_gen', table, 'columns', column, 'weights'],
            message: 'weights must have one entry per value',
          });
        }
      }
    }
  });

/** Parsed template with defaults applied. */
export type QuestionTemplate = z.infer<typeof questionTemplateSchema>;
/** What an author writes (defaults optional). */
export type QuestionTemplateInput = z.input<typeof questionTemplateSchema>;
export type ColumnSpec = z.infer<typeof columnSpecSchema>;
export type TableSpec = z.infer<typeof tableSpecSchema>;
export type ParamSpec = z.infer<typeof paramSpecSchema>;
export type Hint = z.infer<typeof hintSchema>;
