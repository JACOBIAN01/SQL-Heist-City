import { questionTemplateSchema, type QuestionTemplate } from '@heist/shared';
import type { QuestionTester } from './QuestionTester';

/** Stricter than save-time validation: this is the QA gate for shipped content. */
export interface ContentRules {
  readonly seeds: number;
  /** Minimum share of player pairs that must get different answers (anti-copy). */
  readonly minDifferentAnswerRate: number;
  readonly slowMs: number;
}

export const CONTENT_RULES: ContentRules = {
  seeds: 100,
  /** At most 5% of player pairs may share an answer (docs/questions.md). */
  minDifferentAnswerRate: 0.95,
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
        if (result.differentAnswerRate < this.rules.minDifferentAnswerRate) {
          report(
            'error',
            `${Math.round((1 - result.differentAnswerRate) * 100)}% of player pairs get the same answer (max ${Math.round((1 - this.rules.minDifferentAnswerRate) * 100)}%) — players could share answers`,
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
