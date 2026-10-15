import {
  SeededRng,
  themeSql,
  themeStory,
  type QuestionTemplate,
  type Rng,
  type Theme,
} from '@heist/shared';
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
  /** The story theme this player got (tables, columns and words renamed), or null for the plain one. */
  readonly theme: Theme | null;
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
    const generated = generateTables(template.data_gen, dataRng, this.datasets, maxRows);
    // Its own stream, so adding themes to a question never changes its params or data.
    const theme =
      template.themes.length === 0
        ? null
        : new SeededRng(`${seed}/theme`).pick([null, ...template.themes]);
    return {
      slug: template.slug,
      seed,
      tier: template.tier,
      title: theme?.title ?? template.title,
      story: themeStory(renderTemplate(template.story_md, params), theme),
      schemaSql: themeSql(template.schema_sql, theme),
      tables: themeTables(generated, theme),
      params,
      referenceSql: themeSql(renderTemplate(template.reference_sql, params), theme),
      orderMatters: template.order_matters,
      compare: template.compare,
      allowEmpty: template.allow_empty,
      theme,
    };
  }
}

/** The generated tables under the theme's table and column names (data unchanged). */
function themeTables(tables: GeneratedTables, theme: Theme | null): GeneratedTables {
  if (!theme) return tables;
  return new Map(
    [...tables].map(([name, table]) => [
      theme.tables[name] ?? name,
      { ...table, columns: table.columns.map((c) => theme.columns[c] ?? c) },
    ]),
  );
}
