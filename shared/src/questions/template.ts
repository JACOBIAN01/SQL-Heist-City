import { z } from 'zod';
import { bloomSchema, marksSchema, rcsbeSchema } from './analytics';
import { SQL_TASKS, taskSchema } from './taskTypes';
import { themeSchema } from './themes';

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
  /**
   * These values in this order (row i gets values[i], repeating). With a fixed row count it gives
   * tables every player sees the same, for tasks whose answer must not depend on the data
   * (predict the output, explain the error).
   */
  z.object({
    kind: z.literal('list'),
    values: z.array(z.union([z.string(), z.number(), z.null()])).min(1),
  }),
  z.object({
    kind: z.literal('tree_parent'),
    /** Id of the table's first row (match the serial column's start). */
    start: z.number().int().default(1),
    /** How many leading rows are roots (NULL parent). */
    roots: z.number().int().min(1).default(1),
  }),
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
    /** What this question measures: exactly one RCSBE dimension (docs/RCBSE.md). */
    rcsbe: rcsbeSchema,
    /** The cognitive level, for curriculum alignment. */
    bloom: bloomSchema,
    /** Weight in marks; empty means the default for its tier. */
    marks: marksSchema.optional(),
    story_md: z.string().min(1),
    schema_sql: z.string().min(1),
    data_gen: z.record(identifier, tableSpecSchema),
    params: z.record(identifier, paramSpecSchema).default({}),
    /** What the task asks (default: write a query). */
    task: taskSchema.default({ kind: 'write' }),
    /** The answer query (SQL-graded tasks); for write_db the reference statements. */
    reference_sql: z.string().default(''),
    order_matters: z.boolean().default(false),
    compare: z
      .object({ names: z.boolean().default(false), case: z.boolean().default(true) })
      .default({ names: false, case: true }),
    allow_empty: z.boolean().default(false),
    hints: z.array(hintSchema).default([]),
    /** Story themes: each player gets the plain question or one of these (seeded). */
    themes: z.array(themeSchema).max(5).default([]),
    enabled: z.boolean().default(true),
  })
  .superRefine((q, ctx) => {
    if (SQL_TASKS.has(q.task.kind) && q.reference_sql.trim() === '')
      ctx.addIssue({
        code: 'custom',
        path: ['reference_sql'],
        message: 'this kind of task needs a reference_sql',
      });
    if (q.task.kind === 'choice') {
      q.task.parts.forEach((part, i) => {
        const ids = new Set(part.options.map((o) => o.id));
        if (ids.size !== part.options.length)
          ctx.addIssue({
            code: 'custom',
            path: ['task', 'parts', i, 'options'],
            message: 'option ids must be unique',
          });
        for (const c of part.correct)
          if (!ids.has(c))
            ctx.addIssue({
              code: 'custom',
              path: ['task', 'parts', i, 'correct'],
              message: `no option "${c}"`,
            });
        if (!part.multi && part.correct.length !== 1)
          ctx.addIssue({
            code: 'custom',
            path: ['task', 'parts', i, 'correct'],
            message: 'a single-answer part has exactly one right option',
          });
      });
    }
    if (q.task.kind === 'fill') {
      const holes = (q.task.text_sql.match(/___/g) ?? []).length;
      if (holes !== q.task.blanks.length)
        ctx.addIssue({
          code: 'custom',
          path: ['task', 'blanks'],
          message: `the query has ${holes} blank(s) (___) but ${q.task.blanks.length} answer list(s)`,
        });
    }
    const tables = new Set(Object.keys(q.data_gen));
    const columns = new Set(Object.values(q.data_gen).flatMap((t) => Object.keys(t.columns)));
    q.themes.forEach((theme, i) => {
      for (const t of Object.keys(theme.tables))
        if (!tables.has(t))
          ctx.addIssue({
            code: 'custom',
            path: ['themes', i, 'tables'],
            message: `no table "${t}"`,
          });
      for (const c of Object.keys(theme.columns))
        if (!columns.has(c))
          ctx.addIssue({
            code: 'custom',
            path: ['themes', i, 'columns'],
            message: `no column "${c}"`,
          });
      for (const to of [...Object.values(theme.tables), ...Object.values(theme.columns)])
        if ((tables.has(to) || columns.has(to)) && !(to in theme.tables) && !(to in theme.columns))
          ctx.addIssue({
            code: 'custom',
            path: ['themes', i],
            message: `"${to}" is already a name in this question`,
          });
    });
    if (q.task.kind === 'brief' && q.rcsbe !== 'B')
      ctx.addIssue({
        code: 'custom',
        path: ['rcsbe'],
        message: 'an open brief measures Build (B)',
      });
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

/**
 * A template read back from storage. Questions saved before the RCSBE tags
 * existed have none; they read as Solve / Apply (what every one of them was)
 * until a teacher or `db:seed --update` tags them properly.
 */
export function parseStoredTemplate(raw: unknown): QuestionTemplate {
  const legacy =
    typeof raw === 'object' && raw !== null
      ? { rcsbe: 'S', bloom: 'apply', ...(raw as Record<string, unknown>) }
      : raw;
  return questionTemplateSchema.parse(legacy);
}
