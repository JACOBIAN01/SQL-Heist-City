import type { QuestionTemplate, SeedPreview } from '@heist/shared';
import { HttpError } from '../http/errors';
import type { QuestionTester } from './QuestionTester';

export const VALIDATION_SEEDS = [
  'validate-1',
  'validate-2',
  'validate-3',
  'validate-4',
  'validate-5',
];

// SOLID: D (Dependency Inversion) — Why: QuestionAdminService only knows
// "a template must pass validation before saving". Tests can swap in a
// permissive validator, and the rule (how many seeds, what counts as broken)
// lives in one class.
export interface TemplateValidator {
  /** Throws a 422 HttpError explaining what failed. */
  assertValid(template: QuestionTemplate): Promise<void>;
}

/** A question may only be saved if its reference query works on ≥5 seeds. */
export class SandboxTemplateValidator implements TemplateValidator {
  constructor(
    private readonly tester: QuestionTester,
    private readonly seeds: readonly string[] = VALIDATION_SEEDS,
  ) {}

  async assertValid(template: QuestionTemplate): Promise<void> {
    const report = await this.tester.test(template, [...this.seeds]);
    const failed = report.seeds.filter((s) => s.issues.some((i) => i !== 'slow'));
    if (failed.length === 0) return;
    throw new HttpError(
      422,
      'question_invalid',
      `The reference query failed on ${failed.length} of ${report.seeds.length} test seeds`,
      failed.map((s: SeedPreview) => ({ seed: s.seed, issues: s.issues, error: s.error ?? null })),
    );
  }
}
