import {
  questionTemplateSchema,
  type AdminUser,
  type ImportItemResult,
  type ImportQuery,
  type ImportReport,
  type QuestionTemplate,
} from '@heist/shared';
import { HttpError } from '../../http/errors';
import type { QuestionAdminService } from '../QuestionAdminService';
import type { TemplateValidator } from '../TemplateValidator';
import type { QuestionFormat } from './formats';

/**
 * Bulk import/export through the same rules as single edits: schema check,
 * sandbox validation, then QuestionAdminService (so audit + reload fire).
 * Items are independent — one bad row doesn't block the others.
 */
export class QuestionImportService {
  constructor(
    private readonly questions: QuestionAdminService,
    private readonly validator: TemplateValidator,
  ) {}

  export(format: QuestionFormat): string {
    return format.serialize(this.questions.allTemplates());
  }

  async import(
    format: QuestionFormat,
    body: unknown,
    options: ImportQuery,
    actor: AdminUser,
  ): Promise<ImportReport> {
    const raws = format.parse(body);
    const seen = new Set<string>();
    const items: ImportItemResult[] = [];

    for (const raw of raws) {
      const slugGuess =
        typeof (raw.data as { slug?: unknown })?.slug === 'string'
          ? (raw.data as { slug: string }).slug
          : null;
      const parsed = questionTemplateSchema.safeParse(raw.data);
      if (!parsed.success) {
        items.push({
          index: raw.index,
          slug: slugGuess,
          status: 'invalid',
          errors: parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
        });
        continue;
      }
      const template = parsed.data;
      if (seen.has(template.slug)) {
        items.push({
          index: raw.index,
          slug: template.slug,
          status: 'invalid',
          errors: ['slug appears twice in this file'],
        });
        continue;
      }
      seen.add(template.slug);
      items.push(await this.importOne(raw.index, template, options, actor));
    }

    const counts = { created: 0, updated: 0, skipped: 0, invalid: 0 };
    for (const item of items) counts[item.status]++;
    return { dryRun: options.dryRun, items, counts };
  }

  private async importOne(
    index: number,
    template: QuestionTemplate,
    options: ImportQuery,
    actor: AdminUser,
  ): Promise<ImportItemResult> {
    const existing = this.questions.findBySlug(template.slug);
    if (existing && options.onConflict === 'skip') {
      return { index, slug: template.slug, status: 'skipped', errors: ['slug already exists'] };
    }
    try {
      await this.validator.assertValid(template);
    } catch (err) {
      if (!(err instanceof HttpError)) throw err;
      const details = Array.isArray(err.details)
        ? (err.details as { seed: string; error: string | null; issues: string[] }[])
        : [];
      return {
        index,
        slug: template.slug,
        status: 'invalid',
        errors: [
          err.message,
          ...details.slice(0, 2).map((d) => `${d.seed}: ${d.error ?? d.issues.join(', ')}`),
        ],
      };
    }
    const status = existing ? 'updated' : 'created';
    if (!options.dryRun) {
      if (existing) await this.questions.update(existing.id, template, actor, { validated: true });
      else await this.questions.create(template, actor, { validated: true });
    }
    return { index, slug: template.slug, status };
  }
}
