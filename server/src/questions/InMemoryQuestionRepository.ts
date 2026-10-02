import type { QuestionTemplate } from '@heist/shared';
import {
  DuplicateSlugError,
  QuestionNotFoundError,
  type QuestionFilter,
  type QuestionRepository,
  type QuestionVersion,
  type StoredQuestion,
} from './QuestionRepository';

interface Entry {
  current: StoredQuestion;
  versions: QuestionVersion[];
  deleted: boolean;
}

/** Test fake with the same contract as SqliteQuestionRepository (see the contract tests). */
export class InMemoryQuestionRepository implements QuestionRepository {
  private readonly entries = new Map<number, Entry>();
  private nextId = 1;

  constructor(private readonly now: () => string = () => new Date().toISOString()) {}

  getById(id: number): StoredQuestion | undefined {
    const e = this.entries.get(id);
    return e && !e.deleted ? e.current : undefined;
  }

  getBySlug(slug: string): StoredQuestion | undefined {
    return this.live().find((q) => q.slug === slug);
  }

  list(filter: QuestionFilter = {}): StoredQuestion[] {
    return this.live().filter(
      (q) =>
        (filter.tierMin === undefined || q.template.tier >= filter.tierMin) &&
        (filter.tierMax === undefined || q.template.tier <= filter.tierMax) &&
        (filter.enabled === undefined || q.enabled === filter.enabled) &&
        (filter.topic === undefined || q.template.topic.includes(filter.topic)),
    );
  }

  create(template: QuestionTemplate, actor: string | null): StoredQuestion {
    this.assertSlugFree(template.slug, null);
    const id = this.nextId++;
    const entry: Entry = { current: this.stored(id, 1, template), versions: [], deleted: false };
    entry.versions.push(this.version(1, template, actor));
    this.entries.set(id, entry);
    return entry.current;
  }

  update(id: number, template: QuestionTemplate, actor: string | null): StoredQuestion {
    const entry = this.mustGet(id);
    this.assertSlugFree(template.slug, id);
    const version = entry.current.version + 1;
    entry.current = this.stored(id, version, template);
    entry.versions.push(this.version(version, template, actor));
    return entry.current;
  }

  setEnabled(id: number, enabled: boolean, actor: string | null): StoredQuestion {
    const { current } = this.mustGet(id);
    if (current.enabled === enabled) return current;
    return this.update(id, { ...current.template, enabled }, actor);
  }

  remove(id: number, _actor: string | null): void {
    this.mustGet(id).deleted = true;
  }

  versions(id: number): QuestionVersion[] {
    return [...this.mustGet(id).versions];
  }

  private live(): StoredQuestion[] {
    return [...this.entries.values()].filter((e) => !e.deleted).map((e) => e.current);
  }

  private mustGet(id: number): Entry {
    const e = this.entries.get(id);
    if (!e || e.deleted) throw new QuestionNotFoundError(id);
    return e;
  }

  private assertSlugFree(slug: string, exceptId: number | null): void {
    for (const [id, e] of this.entries) {
      if (e.current.slug === slug && id !== exceptId) throw new DuplicateSlugError(slug);
    }
  }

  private stored(id: number, version: number, template: QuestionTemplate): StoredQuestion {
    return {
      id,
      slug: template.slug,
      version,
      enabled: template.enabled,
      template: structuredClone(template),
      updatedAt: this.now(),
    };
  }

  private version(version: number, template: QuestionTemplate, actor: string | null) {
    return {
      version,
      template: structuredClone(template),
      createdBy: actor,
      createdAt: this.now(),
    };
  }
}
