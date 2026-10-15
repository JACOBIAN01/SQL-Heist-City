import type { Variant } from '../variants/VariantBuilder';
import { FeedbackBuilder, type Feedback } from './FeedbackBuilder';
import { ResultComparator } from './ResultComparator';
import type { JobOutcome, QueryOutcome, SandboxQuery, SandboxRunner } from './SandboxRunner';
import type { QueryResult } from './SqlSandbox';

export type GradeResult =
  | { readonly status: 'correct' }
  /** Query ran but the result is wrong. Counts as a wrong attempt. */
  | { readonly status: 'wrong'; readonly feedback: Feedback }
  /** Query didn't run (syntax, not allowed, timeout). Counts as a wrong attempt. */
  | { readonly status: 'error'; readonly feedback: Feedback }
  /** Our fault (worker crash). Never penalise the student. */
  | { readonly status: 'unavailable'; readonly reason: string };

export type PreviewResult =
  | { readonly status: 'ok'; readonly result: QueryResult }
  | { readonly status: 'error'; readonly feedback: Feedback }
  | { readonly status: 'unavailable'; readonly reason: string };

/** The question itself is broken for this seed (author bug). */
export class ReferenceQueryError extends Error {
  constructor(
    readonly slug: string,
    readonly seed: string,
    message: string,
  ) {
    super(`reference query of "${slug}" failed for seed ${seed}: ${message}`);
    this.name = 'ReferenceQueryError';
  }
}

export const PREVIEW_ROWS = 5;

type RunOutcome =
  | { readonly kind: 'ran'; readonly outcome: QueryOutcome }
  | { readonly kind: 'timeout' }
  | { readonly kind: 'unavailable'; readonly reason: string };

// SOLID: S (Single Responsibility) — Why: the grader only runs and compares
// queries. Picking questions (QuestionSelector), building variants
// (VariantBuilder) and wording hints (FeedbackBuilder) change for other
// reasons and live elsewhere.
export class Grader {
  constructor(
    private readonly runner: SandboxRunner,
    private readonly feedback: FeedbackBuilder = new FeedbackBuilder(),
  ) {}

  /**
   * Runs the reference query once per challenge. Computing it up front means a
   * later timeout during grading can only be the student's query.
   */
  async expectedResult(variant: Variant): Promise<QueryResult> {
    const run = await this.run(variant, variant.referenceSql);
    const fail = (why: string) => new ReferenceQueryError(variant.slug, variant.seed, why);
    if (run.kind === 'timeout') throw fail('timed out');
    if (run.kind === 'unavailable') throw fail(run.reason);
    if (!run.outcome.ok) throw fail(run.outcome.message);
    const result = run.outcome.result;
    if (result.truncated) throw fail('result exceeds the row cap');
    if (result.rows.length === 0 && !variant.allowEmpty) {
      throw fail('empty result (allow_empty is off)');
    }
    return result;
  }

  async grade(variant: Variant, expected: QueryResult, studentSql: string): Promise<GradeResult> {
    const run = await this.run(variant, studentSql);
    if (run.kind === 'unavailable') return { status: 'unavailable', reason: run.reason };
    if (run.kind === 'timeout') return { status: 'error', feedback: this.feedback.timeout() };
    const { outcome } = run;
    if (!outcome.ok) {
      return {
        status: 'error',
        feedback: this.feedback.fromSandboxError(outcome.code, outcome.message),
      };
    }
    const comparison = new ResultComparator({
      orderMatters: variant.orderMatters,
      compareNames: variant.compare.names,
      caseSensitive: variant.compare.case,
    }).compare(expected, outcome.result);
    if (comparison.match) return { status: 'correct' };
    return {
      status: 'wrong',
      feedback: this.feedback.fromMismatch(comparison.mismatch, outcome.result.columns),
    };
  }

  /** The plan of a query (`faster` tasks), one line per step. */
  async plan(
    variant: Variant,
    sql: string,
  ): Promise<
    | { readonly status: 'ok'; readonly lines: readonly string[] }
    | { readonly status: 'error'; readonly feedback: Feedback }
    | { readonly status: 'unavailable'; readonly reason: string }
  > {
    const run = await this.runQueries(variant, [{ sql, mode: 'plan' }]);
    if (run.kind === 'unavailable') return { status: 'unavailable', reason: run.reason };
    if (run.kind === 'timeout') return { status: 'error', feedback: this.feedback.timeout() };
    const outcome = run.outcomes[0] as QueryOutcome;
    if (!outcome.ok)
      return {
        status: 'error',
        feedback: this.feedback.fromSandboxError(outcome.code, outcome.message),
      };
    return { status: 'ok', lines: outcome.result.rows.map((r) => String(r[0])) };
  }

  /** What `check` returns after `statements` changed the tables (write tasks). */
  async stateAfter(
    variant: Variant,
    statements: string,
    check: string,
  ): Promise<
    | { readonly status: 'ok'; readonly result: QueryResult }
    | { readonly status: 'error'; readonly feedback: Feedback }
    | { readonly status: 'unavailable'; readonly reason: string }
  > {
    const run = await this.runQueries(variant, [
      { sql: statements, mode: 'write' },
      { sql: check },
    ]);
    if (run.kind === 'unavailable') return { status: 'unavailable', reason: run.reason };
    if (run.kind === 'timeout') return { status: 'error', feedback: this.feedback.timeout() };
    for (const outcome of run.outcomes)
      if (!outcome.ok)
        return {
          status: 'error',
          feedback: this.feedback.fromSandboxError(outcome.code, outcome.message),
        };
    return {
      status: 'ok',
      result: (run.outcomes[1] as Extract<QueryOutcome, { ok: true }>).result,
    };
  }

  /** Grades a write task: the state the student's statements leave, against the reference's. */
  async gradeState(
    variant: Variant,
    expected: QueryResult,
    statements: string,
    check: string,
  ): Promise<GradeResult> {
    const state = await this.stateAfter(variant, statements, check);
    if (state.status !== 'ok') return state;
    const comparison = new ResultComparator({
      orderMatters: variant.orderMatters,
      compareNames: false,
      caseSensitive: variant.compare.case,
    }).compare(expected, state.result);
    if (comparison.match) return { status: 'correct' };
    return {
      status: 'wrong',
      feedback: {
        code: 'values',
        message: 'The tables do not end up as asked. Check which rows your statements change.',
      },
    };
  }

  /** The free "Run" button: first few rows of the student's query, no grading. */
  async preview(
    variant: Variant,
    studentSql: string,
    maxRows = PREVIEW_ROWS,
  ): Promise<PreviewResult> {
    const run = await this.run(variant, studentSql, maxRows);
    if (run.kind === 'unavailable') return { status: 'unavailable', reason: run.reason };
    if (run.kind === 'timeout') return { status: 'error', feedback: this.feedback.timeout() };
    const { outcome } = run;
    if (!outcome.ok) {
      return {
        status: 'error',
        feedback: this.feedback.fromSandboxError(outcome.code, outcome.message),
      };
    }
    return { status: 'ok', result: outcome.result };
  }

  private async runQueries(
    variant: Variant,
    queries: readonly SandboxQuery[],
  ): Promise<
    | { readonly kind: 'ran'; readonly outcomes: readonly QueryOutcome[] }
    | { readonly kind: 'timeout' }
    | { readonly kind: 'unavailable'; readonly reason: string }
  > {
    const job = await this.runner.run({
      data: { schemaSql: variant.schemaSql, tables: variant.tables },
      queries,
    });
    if (job.ok) return { kind: 'ran', outcomes: job.outcomes };
    if (job.code === 'timeout') return { kind: 'timeout' };
    return { kind: 'unavailable', reason: `${job.code}: ${job.message}` };
  }

  private async run(variant: Variant, sql: string, maxRows?: number): Promise<RunOutcome> {
    const job: JobOutcome = await this.runner.run({
      data: { schemaSql: variant.schemaSql, tables: variant.tables },
      queries: [maxRows === undefined ? { sql } : { sql, maxRows }],
    });
    if (job.ok) return { kind: 'ran', outcome: job.outcomes[0] as QueryOutcome };
    if (job.code === 'timeout') return { kind: 'timeout' };
    return { kind: 'unavailable', reason: `${job.code}: ${job.message}` };
  }
}
