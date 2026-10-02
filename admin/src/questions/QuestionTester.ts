import type { PreviewIssue, PreviewReport, QuestionTemplate, SeedPreview } from '@heist/shared';
import type { Grader } from '@heist/server/sql/Grader';
import { ReferenceQueryError } from '@heist/server/sql/Grader';
import type { VariantBuilder } from '@heist/server/variants/VariantBuilder';

export const DEFAULT_PREVIEW_SEEDS = ['preview-1', 'preview-2', 'preview-3'];
/** Reference queries slower than this are flagged (docs/questions.md). */
export const SLOW_MS = 200;

/**
 * Runs a question template the way the game would, for teachers: instantiate
 * per seed, run the reference query, optionally grade a student query, and
 * flag problems (errors, empty or capped results, slow queries).
 */
export class QuestionTester {
  constructor(
    private readonly variants: VariantBuilder,
    private readonly grader: Grader,
    private readonly now: () => number = () => performance.now(),
  ) {}

  async test(
    template: QuestionTemplate,
    seeds = DEFAULT_PREVIEW_SEEDS,
    studentSql?: string,
  ): Promise<PreviewReport> {
    const results: SeedPreview[] = [];
    const fingerprints: string[] = [];
    for (const seed of seeds) {
      const preview = await this.testSeed(template, seed, studentSql);
      results.push(preview);
      if (preview.expected) fingerprints.push(JSON.stringify(preview.expected.rows));
    }
    return {
      seeds: results,
      distinctResultRatio: distinctRatio(fingerprints),
      ok: results.every((r) => r.issues.every((i) => i === 'slow')),
    };
  }

  private async testSeed(
    template: QuestionTemplate,
    seed: string,
    studentSql?: string,
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
    let expected;
    try {
      expected = await this.grader.expectedResult(variant);
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
    const preview: SeedPreview = {
      ...base,
      expected: { columns: expected.columns, rows: expected.rows },
      runtimeMs,
      issues,
    };
    if (studentSql === undefined) return preview;
    const grade = await this.grader.grade(variant, expected, studentSql);
    return {
      ...preview,
      student: {
        status: grade.status,
        ...('feedback' in grade ? { feedback: grade.feedback } : {}),
      },
    };
  }
}

function distinctRatio(fingerprints: readonly string[]): number {
  if (fingerprints.length <= 1) return 1;
  const counts = new Map<string, number>();
  for (const f of fingerprints) counts.set(f, (counts.get(f) ?? 0) + 1);
  return fingerprints.filter((f) => counts.get(f) === 1).length / fingerprints.length;
}
