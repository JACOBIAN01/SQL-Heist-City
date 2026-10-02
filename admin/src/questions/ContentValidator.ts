import { questionTemplateSchema, type QuestionTemplate } from '@heist/shared';
import type { QuestionTester } from './QuestionTester';

/** Stricter than save-time validation: this is the QA gate for shipped content. */
export interface ContentRules {
  readonly seeds: number;
  readonly minDistinctRatio: number;
  readonly slowMs: number;
}

export const CONTENT_RULES: ContentRules = {
  seeds: 30,
  /** Share of seeds whose answer must be unique (anti-copy; docs/questions.md). */
  minDistinctRatio: 0.8,
  /** A reference query slower than this on any seed is reported. */
  slowMs: 200,
};

export interface ContentProblem {
  readonly file: string;
  readonly slug: string | null;
  readonly level: 'error' | 'warning';
  readonly message: string;
}

export interface ContentReport {
  readonly questions: number;
  readonly byTier: Readonly<Record<number, number>>;
  readonly problems: readonly ContentProblem[];
}

export interface ContentFile {
  readonly name: string;
  /** Parsed JSON: an array or { questions: [...] } (the export format). */
  readonly data: unknown;
}

/**
 * Checks question files before they are imported: schema, unique slugs, and
 * every reference query on many seeds (no errors, no empty or capped
 * results, answers that differ between players, acceptable speed).
 */
export class ContentValidator {
  constructor(
    private readonly tester: QuestionTester,
    private readonly rules: ContentRules = CONTENT_RULES,
  ) {}

  async validate(files: readonly ContentFile[]): Promise<ContentReport> {
    const problems: ContentProblem[] = [];
    const slugs = new Map<string, string>();
    const byTier: Record<number, number> = {};
    let count = 0;
    const seeds = Array.from({ length: this.rules.seeds }, (_, i) => `qa-${i + 1}`);

    for (const file of files) {
      const list = Array.isArray(file.data)
        ? file.data
        : ((file.data as { questions?: unknown[] } | null)?.questions ?? null);
      if (!list) {
        problems.push({
          file: file.name,
          slug: null,
          level: 'error',
          message: 'not a question list',
        });
        continue;
      }
      for (const [i, raw] of list.entries()) {
        const parsed = questionTemplateSchema.safeParse(raw);
        const slug = (raw as { slug?: string })?.slug ?? null;
        const report = (level: ContentProblem['level'], message: string) =>
          problems.push({ file: file.name, slug: slug ?? `#${i + 1}`, level, message });
        if (!parsed.success) {
          for (const issue of parsed.error.issues)
            report('error', `${issue.path.join('.')}: ${issue.message}`);
          continue;
        }
        const q: QuestionTemplate = parsed.data;
        count++;
        byTier[q.tier] = (byTier[q.tier] ?? 0) + 1;
        const seenIn = slugs.get(q.slug);
        if (seenIn) report('error', `duplicate slug (also in ${seenIn})`);
        slugs.set(q.slug, file.name);

        const result = await this.tester.test(q, seeds);
        const failing = result.seeds.filter((s) => s.issues.some((x) => x !== 'slow'));
        if (failing.length > 0) {
          const first = failing[0];
          report(
            'error',
            `${failing.length}/${seeds.length} seeds fail — ${first?.seed}: ${first?.error ?? first?.issues.join(', ')}`,
          );
        }
        if (result.distinctResultRatio < this.rules.minDistinctRatio) {
          report(
            'error',
            `only ${Math.round(result.distinctResultRatio * 100)}% of seeds have a unique answer (need ${this.rules.minDistinctRatio * 100}%) — answers can be shared`,
          );
        }
        const slowest = Math.max(...result.seeds.map((s) => s.runtimeMs));
        if (slowest > this.rules.slowMs)
          report('warning', `slow reference query (${slowest.toFixed(0)} ms)`);
      }
    }
    return { questions: count, byTier, problems };
  }
}
