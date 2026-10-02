import type {
  AdminUser,
  QuestionDetail,
  QuestionListQuery,
  QuestionSummary,
  QuestionTemplate,
} from '@heist/shared';
import {
  DuplicateSlugError,
  type QuestionRepository,
  type StoredQuestion,
} from '@heist/server/questions/QuestionRepository';
import { conflict, notFound } from '../http/errors';
import type { AdminEventBus, QuestionAction } from '../events/AdminEvents';

// Pattern: Facade — Why: routes call one method per teacher action; the
// repository, slug rules and change events stay behind it, so every way of
// changing a question (UI, import, rollback) follows the same steps.
export class QuestionAdminService {
  constructor(
    private readonly questions: QuestionRepository,
    private readonly events: AdminEventBus,
  ) {}

  list(query: QuestionListQuery = {}): QuestionSummary[] {
    const needle = query.q?.toLowerCase();
    return this.questions
      .list({
        ...(query.tier === undefined ? {} : { tierMin: query.tier, tierMax: query.tier }),
        ...(query.topic === undefined ? {} : { topic: query.topic }),
        ...(query.enabled === undefined ? {} : { enabled: query.enabled }),
      })
      .filter(
        (q) =>
          !needle || q.slug.includes(needle) || q.template.title.toLowerCase().includes(needle),
      )
      .map(toSummary);
  }

  get(id: number): QuestionDetail {
    return toDetail(this.mustGet(id));
  }

  create(template: QuestionTemplate, actor: AdminUser): QuestionDetail {
    const created = this.withSlugCheck(() => this.questions.create(template, actor.email));
    this.emit('create', created.id, actor, undefined, created.template);
    return toDetail(created);
  }

  update(id: number, template: QuestionTemplate, actor: AdminUser): QuestionDetail {
    const before = this.mustGet(id);
    const updated = this.withSlugCheck(() => this.questions.update(id, template, actor.email));
    this.emit('update', id, actor, before.template, updated.template);
    return toDetail(updated);
  }

  setEnabled(id: number, enabled: boolean, actor: AdminUser): QuestionDetail {
    const before = this.mustGet(id);
    const updated = this.questions.setEnabled(id, enabled, actor.email);
    if (updated.version !== before.version) {
      this.emit(enabled ? 'enable' : 'disable', id, actor, before.template, updated.template);
    }
    return toDetail(updated);
  }

  duplicate(id: number, actor: AdminUser): QuestionDetail {
    const source = this.mustGet(id);
    // Try slug-copy, slug-copy-2, … ; create() also sees soft-deleted slugs.
    for (let n = 1; ; n++) {
      const slug = n === 1 ? `${source.slug}-copy` : `${source.slug}-copy-${n}`;
      try {
        const copy = this.questions.create(
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

  remove(id: number, actor: AdminUser): void {
    const before = this.mustGet(id);
    this.questions.remove(id, actor.email);
    this.emit('delete', id, actor, before.template, undefined);
  }

  private mustGet(id: number): StoredQuestion {
    const q = this.questions.getById(id);
    if (!q) throw notFound('Question');
    return q;
  }

  private withSlugCheck<T>(fn: () => T): T {
    try {
      return fn();
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
