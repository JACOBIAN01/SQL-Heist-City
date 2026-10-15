import {
  DEFAULT_CHALLENGE_SETTINGS,
  type PreviewIssue,
  type PreviewReport,
  type QuestionTemplate,
  type SeedPreview,
} from '@heist/shared';
import { ExampleBuilder } from '@heist/server/challenges/ExampleBuilder';
import type { Grader } from '@heist/server/sql/Grader';
import { ReferenceQueryError } from '@heist/server/sql/Grader';
import type { VariantBuilder } from '@heist/server/variants/VariantBuilder';
import { taskHandler } from '@heist/server/challenges/tasks/handlers';
import type { PreparedTask, TaskContext } from '@heist/server/challenges/tasks/TaskHandler';

export const DEFAULT_PREVIEW_SEEDS = ['preview-1', 'preview-2', 'preview-3'];
/** Reference queries slower than this are flagged (docs/questions.md). */
export const SLOW_MS = 200;

/**
 * Runs a question template the way the game would, for teachers: instantiate
 * per seed, run the reference query, optionally grade a student query, and
 * flag problems (errors, empty or capped results, slow queries).
 */
export class QuestionTester {
  private readonly examples: ExampleBuilder;

  constructor(
    private readonly variants: VariantBuilder,
    private readonly grader: Grader,
    private readonly now: () => number = () => performance.now(),
  ) {
    this.examples = new ExampleBuilder(variants, grader);
  }

  /** `exampleSeeds`: how many of the seeds (the first ones) also get the players' worked example. */
  async test(
    template: QuestionTemplate,
    seeds = DEFAULT_PREVIEW_SEEDS,
    studentSql?: string,
    exampleSeeds = seeds.length,
  ): Promise<PreviewReport> {
    const results: SeedPreview[] = [];
    const fingerprints: string[] = [];
    for (const [i, seed] of seeds.entries()) {
      const preview = await this.testSeed(template, seed, studentSql, i < exampleSeeds);
      results.push(preview);
      if (preview.expected) fingerprints.push(JSON.stringify(preview.expected.rows));
    }
    return {
      seeds: results,
      differentAnswerRate: differentPairRate(fingerprints),
      ok: results.every((r) => r.issues.every((i) => i === 'slow')),
    };
  }

  private async testSeed(
    template: QuestionTemplate,
    seed: string,
    studentSql: string | undefined,
    withExample: boolean,
  ): Promise<SeedPreview> {
    const started = this.now();
    let variant;
    try {
      variant = this.variants.build(template, seed);
    } catch (err) {
      return {
        seed,
        runtimeMs: 0,
        issues: ['error'],
        error: `data generation failed: ${(err as Error).message}`,
      };
    }
    const base = {
      seed,
      story: variant.story,
      referenceSql: variant.referenceSql,
      tables: [...variant.tables].map(([name, t]) => ({ name, columns: t.columns, rows: t.rows })),
    };
    const handler = taskHandler(template.task.kind);
    const ctx: TaskContext = { template, variant, grader: this.grader };
    let prepared: PreparedTask;
    try {
      prepared = await handler.prepare(ctx);
    } catch (err) {
      const message =
        err instanceof ReferenceQueryError ? err.message : `unexpected: ${(err as Error).message}`;
      const issue: PreviewIssue = /empty result/.test(message)
        ? 'empty'
        : /row cap/.test(message)
          ? 'truncated'
          : 'error';
      return { ...base, runtimeMs: this.now() - started, issues: [issue], error: message };
    }
    const runtimeMs = this.now() - started;
    const issues: PreviewIssue[] = runtimeMs > SLOW_MS ? ['slow'] : [];
    const given = await this.givenQueryPasses(ctx, prepared);
    if (given) return { ...base, runtimeMs, issues: ['error'], error: given };
    const example =
      withExample && prepared.hasExample ? await this.example(template, seed) : undefined;
    const expected = prepared.expected;
    const preview: SeedPreview = {
      ...base,
      ...(expected ? { expected: { columns: expected.columns, rows: expected.rows } } : {}),
      ...(example ? { example } : {}),
      runtimeMs,
      issues,
    };
    if (studentSql === undefined) return preview;
    const grade = await handler.grade(ctx, prepared, { sql: studentSql });
    return {
      ...preview,
      student: {
        status:
          grade.status === 'correct'
            ? 'correct'
            : grade.status === 'unavailable'
              ? 'unavailable'
              : grade.status === 'error'
                ? 'error'
                : 'wrong',
        ...('feedback' in grade ? { feedback: grade.feedback } : {}),
      },
    };
  }

  /** A fix or faster task whose given query already passes asks nothing: say so. */
  private async givenQueryPasses(ctx: TaskContext, prepared: PreparedTask): Promise<string | null> {
    const p = prepared.public;
    // A fix, faster or write task's own reference must pass its grading (e.g. a faster task's
    // reference within max_scans).
    if (p.kind === 'fix' || p.kind === 'faster' || p.kind === 'write_db') {
      const own = await taskHandler(p.kind).grade(ctx, prepared, { sql: ctx.variant.referenceSql });
      if (own.status !== 'correct')
        return `the reference does not pass its own task: ${'feedback' in own ? own.feedback.message : own.status}`;
    }
    const given = p.kind === 'fix' ? p.brokenSql : p.kind === 'faster' ? p.slowSql : null;
    if (given === null) return null;
    const grade = await taskHandler(p.kind).grade(ctx, prepared, { sql: given });
    return grade.status === 'correct'
      ? `the given ${p.kind === 'fix' ? 'broken' : 'slow'} query already passes`
      : null;
  }

  private async example(template: QuestionTemplate, seed: string): Promise<SeedPreview['example']> {
    const built = await this.examples.build(template, seed, {
      rows: DEFAULT_CHALLENGE_SETTINGS.exampleRows,
      tries: DEFAULT_CHALLENGE_SETTINGS.exampleTries,
    });
    if (!built) return { tables: [], output: { columns: [], rows: [] }, found: false };
    return {
      tables: [...built.tables].map(([name, t]) => ({ name, columns: t.columns, rows: t.rows })),
      output: { columns: built.output.columns, rows: built.output.rows },
      found: built.found,
    };
  }
}

/** Share of unordered pairs with different answers: 1 − Σ c(c−1) / n(n−1). */
function differentPairRate(fingerprints: readonly string[]): number {
  const n = fingerprints.length;
  if (n <= 1) return 1;
  const counts = new Map<string, number>();
  for (const f of fingerprints) counts.set(f, (counts.get(f) ?? 0) + 1);
  let samePairs = 0;
  for (const c of counts.values()) samePairs += c * (c - 1);
  return 1 - samePairs / (n * (n - 1));
}
