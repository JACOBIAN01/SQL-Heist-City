import type {
  AdminUser,
  QuestionDetail,
  QuestionListQuery,
  QuestionSummary,
  QuestionTemplate,
} from '@heist/shared';
import {
  DuplicateSlugError,
  type QuestionVersion,
  type StoredQuestion,
} from '@heist/server/questions/QuestionRepository';
import type { QuestionStore } from '@heist/server/questions/QuestionStore';
import { conflict, notFound } from '../http/errors';
import type { AdminEventBus, QuestionAction } from '../events/AdminEvents';
import type { TemplateValidator } from './TemplateValidator';

export interface SaveOptions {
  /** The caller already ran the validator (bulk import) — don't run it twice. */
  readonly validated?: boolean;
}

// Pattern: Facade — Why: routes call one method per teacher action; the
// repository, slug rules and change events stay behind it, so every way of
// changing a question (UI, import, rollback) follows the same steps.
export class QuestionAdminService {
  constructor(
    private readonly questions: QuestionStore,
    private readonly events: AdminEventBus,
    private readonly validator: TemplateValidator,
  ) {}

  async list(query: QuestionListQuery = {}): Promise<QuestionSummary[]> {
    const needle = query.q?.toLowerCase();
    return (
      await this.questions.list({
        ...(query.tier === undefined ? {} : { tierMin: query.tier, tierMax: query.tier }),
        ...(query.topic === undefined ? {} : { topic: query.topic }),
        ...(query.enabled === undefined ? {} : { enabled: query.enabled }),
      })
    )
      .filter(
        (q) =>
          !needle || q.slug.includes(needle) || q.template.title.toLowerCase().includes(needle),
      )
      .map(toSummary);
  }

  async findBySlug(slug: string): Promise<QuestionSummary | undefined> {
    const q = await this.questions.getBySlug(slug);
    return q && toSummary(q);
  }

  /** Every non-deleted question's template, for export. */
  async allTemplates(): Promise<QuestionTemplate[]> {
    return (await this.questions.list()).map((q) => q.template);
  }

  async get(id: number): Promise<QuestionDetail> {
    return toDetail(await this.mustGet(id));
  }

  async create(
    template: QuestionTemplate,
    actor: AdminUser,
    options: SaveOptions = {},
  ): Promise<QuestionDetail> {
    if (!options.validated) await this.validator.assertValid(template);
    const created = await this.withSlugCheck(() => this.questions.create(template, actor.email));
    this.emit('create', created.id, actor, undefined, created.template);
    return toDetail(created);
  }

  async update(
    id: number,
    template: QuestionTemplate,
    actor: AdminUser,
    options: SaveOptions = {},
  ): Promise<QuestionDetail> {
    const before = await this.mustGet(id);
    if (!options.validated) await this.validator.assertValid(template);
    const updated = await this.withSlugCheck(() =>
      this.questions.update(id, template, actor.email),
    );
    this.emit('update', id, actor, before.template, updated.template);
    return toDetail(updated);
  }

  async setEnabled(id: number, enabled: boolean, actor: AdminUser): Promise<QuestionDetail> {
    const before = await this.mustGet(id);
    const updated = await this.questions.setEnabled(id, enabled, actor.email);
    if (updated.version !== before.version) {
      this.emit(enabled ? 'enable' : 'disable', id, actor, before.template, updated.template);
    }
    return toDetail(updated);
  }

  async duplicate(id: number, actor: AdminUser): Promise<QuestionDetail> {
    const source = await this.mustGet(id);
    // Try slug-copy, slug-copy-2, … ; create() also sees soft-deleted slugs.
    for (let n = 1; ; n++) {
      const slug = n === 1 ? `${source.slug}-copy` : `${source.slug}-copy-${n}`;
      try {
        const copy = await this.questions.create(
          { ...source.template, slug, title: `${source.template.title} (copy)`, enabled: false },
          actor.email,
        );
        this.emit('duplicate', copy.id, actor, undefined, copy.template, { from: id });
        return toDetail(copy);
      } catch (err) {
        if (!(err instanceof DuplicateSlugError)) throw err;
      }
    }
  }

  async versions(id: number): Promise<QuestionVersion[]> {
    await this.mustGet(id);
    return this.questions.versions(id);
  }

  /** Restores an old version by saving it as a new one — history is never rewritten. */
  async rollback(id: number, version: number, actor: AdminUser): Promise<QuestionDetail> {
    const before = await this.mustGet(id);
    const target = (await this.questions.versions(id)).find((v) => v.version === version);
    if (!target) throw notFound('Version');
    // Old versions may rely on datasets or rules that changed since.
    await this.validator.assertValid(target.template);
    const restored = await this.withSlugCheck(() =>
      this.questions.update(id, target.template, actor.email),
    );
    this.emit('rollback', id, actor, before.template, restored.template, { toVersion: version });
    return toDetail(restored);
  }

  async remove(id: number, actor: AdminUser): Promise<void> {
    const before = await this.mustGet(id);
    await this.questions.remove(id, actor.email);
    this.emit('delete', id, actor, before.template, undefined);
  }

  private async mustGet(id: number): Promise<StoredQuestion> {
    const q = await this.questions.getById(id);
    if (!q) throw notFound('Question');
    return q;
  }

  private async withSlugCheck<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof DuplicateSlugError) throw conflict(`Slug "${err.slug}" is already used`);
      throw err;
    }
  }

  private emit(
    action: QuestionAction,
    questionId: number,
    actor: AdminUser,
    before: QuestionTemplate | undefined,
    after: QuestionTemplate | undefined,
    detail?: Record<string, unknown>,
  ): void {
    this.events.publish({
      type: 'question_changed',
      action,
      questionId,
      actor: { id: actor.id, email: actor.email },
      ...(before === undefined ? {} : { before }),
      ...(after === undefined ? {} : { after }),
      ...(detail === undefined ? {} : { detail }),
    });
  }
}

export function toSummary(q: StoredQuestion): QuestionSummary {
  return {
    id: q.id,
    slug: q.slug,
    title: q.template.title,
    tier: q.template.tier,
    topics: q.template.topic,
    enabled: q.enabled,
    version: q.version,
    updatedAt: q.updatedAt,
  };
}

function toDetail(q: StoredQuestion): QuestionDetail {
  return { ...toSummary(q), template: q.template };
}
