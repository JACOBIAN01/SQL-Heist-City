import { z } from 'zod';
import type { SqlCell } from '../challenges/types';

/**
 * What a question asks the student to do (Phase 17, docs/RCBSE.md §10). Write is
 * today's kind; the others measure Recall, Comprehend, Build and Evaluate.
 */
export const TASK_KINDS = [
  'write',
  'fix',
  'faster',
  'write_db',
  'choice',
  'fill',
  'brief',
] as const;
export type TaskKind = (typeof TASK_KINDS)[number];

/** Kinds graded by running the student's SQL in the sandbox. */
export const SQL_TASKS: ReadonlySet<TaskKind> = new Set(['write', 'fix', 'faster', 'write_db']);

const md = z.string().min(1).max(4000);

const choiceOption = z.object({
  id: z.string().regex(/^[a-z0-9_-]{1,20}$/),
  text_md: md,
});

/** One question in a multiple-choice task; its marks share is its weight among the parts. */
export const choicePartSchema = z.object({
  prompt_md: md,
  options: z.array(choiceOption).min(2).max(8),
  /** The ids of the right options (more than one only when `multi`). */
  correct: z.array(z.string()).min(1),
  multi: z.boolean().default(false),
  /** Weight of this part in the question's marks (Evaluate puts most weight on the reasons). */
  weight: z.number().positive().default(1),
});

export const taskSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('write') }),
  /** S: a broken query is given (and put in the editor); the answer must return the right rows. */
  z.object({ kind: z.literal('fix'), broken_sql: z.string().min(1).max(5000) }),
  /**
   * S: a slow query is given; the answer must return the right rows with at most `max_scans`
   * full table scans in its plan (EXPLAIN QUERY PLAN), so it has to use an index.
   */
  z.object({
    kind: z.literal('faster'),
    slow_sql: z.string().min(1).max(5000),
    max_scans: z.number().int().min(0).max(10),
  }),
  /**
   * S: the student writes INSERT / UPDATE / DELETE / CREATE statements; the result is checked by
   * running `check_sql` on their database and on one changed by the reference statements.
   */
  z.object({ kind: z.literal('write_db'), check_sql: z.string().min(1).max(5000) }),
  /**
   * R, C or E: pick from options. `show_sql` is a query shown with the task; `show` says what of it
   * is shown besides the query itself: its result, its error, or its plan.
   */
  z.object({
    kind: z.literal('choice'),
    show_sql: z.string().max(5000).optional(),
    show: z.enum(['query', 'result', 'error', 'plan']).default('query'),
    parts: z.array(choicePartSchema).min(1).max(5),
    /** Share of the weight needed for the reward (the profile still gets the partial marks). */
    pass_share: z.number().min(0).max(1).default(1),
    /** Show the options in a different order for each player (off for "all of the above"). */
    shuffle: z.boolean().default(true),
  }),
  /** R: fill the blanks (`___`) in a query; each blank accepts any of its answers, ignoring case and spaces. */
  z.object({
    kind: z.literal('fill'),
    text_sql: z.string().min(1).max(5000),
    blanks: z
      .array(z.object({ accept: z.array(z.string().min(1)).min(1) }))
      .min(1)
      .max(10),
  }),
  /**
   * B: an open brief. The student sets the goal and done-condition, writes the queries and says
   * how they know it worked; a teacher marks it against the rubric.
   */
  z.object({
    kind: z.literal('brief'),
    rubric: z
      .array(
        z.object({ criterion: z.string().min(1).max(300), marks: z.number().int().min(1).max(20) }),
      )
      .min(1)
      .max(10),
  }),
]);

export type QuestionTask = z.infer<typeof taskSchema>;

/** What the student sends for a non-SQL task. */
export const taskAnswerSchema = z.object({
  /** For `choice`: the picked option ids, one list per part. */
  choices: z
    .array(z.array(z.string().max(20)).max(8))
    .max(5)
    .optional(),
  /** For `fill`: one string per blank. */
  blanks: z.array(z.string().max(200)).max(10).optional(),
  /** For `brief`: the student's write-up (goal, done-condition, queries, how they know). */
  text: z.string().max(8000).optional(),
});

export type TaskAnswer = z.infer<typeof taskAnswerSchema>;

/** What the pop-up shows of a task (never the right options or accepted answers). */
export type PublicTask =
  | { readonly kind: 'write' }
  | { readonly kind: 'fix'; readonly brokenSql: string }
  | { readonly kind: 'faster'; readonly slowSql: string; readonly maxScans: number }
  | { readonly kind: 'write_db' }
  | {
      readonly kind: 'choice';
      readonly shownSql?: string;
      /** The shown query's result, error message or plan lines, as the task asks. */
      readonly shown?:
        | {
            readonly kind: 'result';
            readonly columns: readonly string[];
            readonly rows: readonly (readonly SqlCell[])[];
          }
        | { readonly kind: 'error'; readonly message: string }
        | { readonly kind: 'plan'; readonly lines: readonly string[] };
      readonly parts: readonly {
        readonly prompt: string;
        readonly options: readonly { readonly id: string; readonly text: string }[];
        readonly multi: boolean;
      }[];
    }
  | { readonly kind: 'fill'; readonly textSql: string; readonly blanks: number }
  | {
      readonly kind: 'brief';
      readonly rubric: readonly { readonly criterion: string; readonly marks: number }[];
    };

/** Normalises a typed blank: case, spaces and a trailing semicolon do not matter. */
export const normaliseBlank = (s: string): string =>
  s.trim().replace(/;+$/, '').replace(/\s+/g, ' ').toUpperCase();
