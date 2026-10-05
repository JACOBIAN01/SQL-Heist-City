import type { QuestionTemplate } from '@heist/shared';
import type { Grader } from '../sql/Grader';
import type { QueryResult } from '../sql/SqlSandbox';
import type { GeneratedTables } from '../variants/dataGenerators';
import type { VariantBuilder } from '../variants/VariantBuilder';

/** A task's worked example: small input tables and what the reference query returns on them. */
export interface WorkedExample {
  readonly tables: GeneratedTables;
  readonly output: QueryResult;
  /** False when no try produced any rows (the output still has the right columns). */
  readonly found: boolean;
}

export interface ExampleOptions {
  /** Rows per table on the first try; each later try allows that many more. */
  readonly rows: number;
  /** Small tries before one last try on full-size example data. */
  readonly tries: number;
}

/**
 * Builds the "expected output" example shown with a task, LeetCode style:
 * the player's own question (same parameters) run on separate, small data.
 * The real data is never used, so the example's answer is not the answer.
 * Small data can miss a filter entirely, so it tries a few data seeds, each
 * a little larger, then full-size data, and keeps the first that returns rows.
 */
export class ExampleBuilder {
  constructor(
    private readonly variants: VariantBuilder,
    private readonly grader: Grader,
  ) {}

  async build(
    template: QuestionTemplate,
    seed: string,
    options: ExampleOptions,
  ): Promise<WorkedExample | undefined> {
    let fallback: WorkedExample | undefined;
    // The last try is full size: a question that needs many rows (HAVING COUNT(*) >= 5)
    // still gets an example, with only its first rows on show.
    for (let k = 1; k <= options.tries + 1; k++) {
      const rows = k > options.tries ? Number.POSITIVE_INFINITY : options.rows * k;
      const variant = this.variants.buildExample(template, seed, `${seed}/example-${k}`, rows);
      let output: QueryResult;
      try {
        // An empty answer is fine here (we just try other data), so it never throws for that.
        output = await this.grader.expectedResult({ ...variant, allowEmpty: true });
      } catch {
        continue; // this data broke the query (e.g. too many rows): try the next
      }
      const example = { tables: variant.tables, output, found: output.rows.length > 0 };
      if (example.found) return example;
      fallback ??= example;
    }
    return fallback;
  }
}
