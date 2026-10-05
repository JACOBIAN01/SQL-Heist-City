import { SeededRng, type QuestionTemplate, type Rng } from '@heist/shared';
import type { DatasetRegistry } from './datasets';
import { generateTables, type GeneratedTables } from './dataGenerators';
import { resolveParams, type ResolvedParams } from './params';
import { renderTemplate } from './render';

/**
 * One concrete instance of a question for one seed. Contains the reference
 * SQL, so it is server-only — never serialise a Variant to a client.
 */
export interface Variant {
  readonly slug: string;
  readonly seed: string;
  readonly tier: number;
  readonly title: string;
  readonly story: string;
  readonly schemaSql: string;
  readonly tables: GeneratedTables;
  readonly params: ResolvedParams;
  readonly referenceSql: string;
  readonly orderMatters: boolean;
  readonly compare: { readonly names: boolean; readonly case: boolean };
  readonly allowEmpty: boolean;
}

// Pattern: Builder — Why: a variant is assembled in steps (params → rendered
// text → generated data) from independent Rng streams; keeping the steps in
// one class makes the order explicit and each step individually testable.
export class VariantBuilder {
  constructor(private readonly datasets: DatasetRegistry) {}

  build(template: QuestionTemplate, seed: string): Variant {
    const rng = new SeededRng(seed);
    return this.assemble(template, seed, rng, rng.fork('data'), Number.POSITIVE_INFINITY);
  }

  /**
   * The same question for the same player (same parameters: same filter, same
   * threshold) on different, smaller data: what the task's worked example is
   * computed on. Its answer is not the real answer, so it can be shown.
   */
  buildExample(
    template: QuestionTemplate,
    seed: string,
    dataSeed: string,
    maxRows: number,
  ): Variant {
    return this.assemble(
      template,
      seed,
      new SeededRng(seed),
      new SeededRng(dataSeed).fork('data'),
      maxRows,
    );
  }

  private assemble(
    template: QuestionTemplate,
    seed: string,
    rng: Rng,
    dataRng: Rng,
    maxRows: number,
  ): Variant {
    const params = resolveParams(template.params, rng.fork('params'), this.datasets);
    const tables = generateTables(template.data_gen, dataRng, this.datasets, maxRows);
    return {
      slug: template.slug,
      seed,
      tier: template.tier,
      title: template.title,
      story: renderTemplate(template.story_md, params),
      schemaSql: template.schema_sql,
      tables,
      params,
      referenceSql: renderTemplate(template.reference_sql, params),
      orderMatters: template.order_matters,
      compare: template.compare,
      allowEmpty: template.allow_empty,
    };
  }
}
