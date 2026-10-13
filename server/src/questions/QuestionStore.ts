import type { QuestionTemplate } from '@heist/shared';
import type {
  QuestionFilter,
  QuestionRepository,
  QuestionVersion,
  StoredQuestion,
} from './QuestionRepository';

// Pattern: Repository (async) — Why: the admin writes through this, so it can sit on
// SQLite (dev, fast tests) or PostgreSQL (the system of record) without the
// service knowing. The game server keeps the synchronous QuestionReader
// over its in-memory snapshot: the 20 Hz loop never waits on a database.
export interface QuestionStore {
  getById(id: number): Promise<StoredQuestion | undefined>;
  getBySlug(slug: string): Promise<StoredQuestion | undefined>;
  list(filter?: QuestionFilter): Promise<StoredQuestion[]>;
  /** Creates version 1. Rejects with DuplicateSlugError if the slug is taken. */
  create(template: QuestionTemplate, actor: string | null): Promise<StoredQuestion>;
  update(id: number, template: QuestionTemplate, actor: string | null): Promise<StoredQuestion>;
  setEnabled(id: number, enabled: boolean, actor: string | null): Promise<StoredQuestion>;
  remove(id: number, actor: string | null): Promise<void>;
  versions(id: number): Promise<QuestionVersion[]>;
}

/** Any synchronous repository, as an async store. */
export class SyncQuestionStore implements QuestionStore {
  constructor(private readonly repo: QuestionRepository) {}

  getById = async (id: number) => this.repo.getById(id);
  getBySlug = async (slug: string) => this.repo.getBySlug(slug);
  list = async (filter?: QuestionFilter) => this.repo.list(filter);
  create = async (template: QuestionTemplate, actor: string | null) =>
    this.repo.create(template, actor);
  update = async (id: number, template: QuestionTemplate, actor: string | null) =>
    this.repo.update(id, template, actor);
  setEnabled = async (id: number, enabled: boolean, actor: string | null) =>
    this.repo.setEnabled(id, enabled, actor);
  remove = async (id: number, actor: string | null) => this.repo.remove(id, actor);
  versions = async (id: number) => this.repo.versions(id);
}
