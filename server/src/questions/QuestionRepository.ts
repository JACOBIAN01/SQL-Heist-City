import type { QuestionTemplate } from '@heist/shared';

/** A question as stored: the validated template plus storage metadata. */
export interface StoredQuestion {
  readonly id: number;
  readonly slug: string;
  readonly version: number;
  readonly enabled: boolean;
  readonly template: QuestionTemplate;
  readonly updatedAt: string;
}

export interface QuestionFilter {
  tierMin?: number;
  tierMax?: number;
  enabled?: boolean;
  topic?: string;
}

export interface QuestionVersion {
  readonly version: number;
  readonly template: QuestionTemplate;
  readonly createdBy: string | null;
  readonly createdAt: string;
}

// SOLID: I (Interface Segregation) — Why: the game server only ever reads
// questions. Giving it this narrow interface (and a read-only DB handle) makes
// it impossible for game code to modify teacher content by accident.
export interface QuestionReader {
  getById(id: number): StoredQuestion | undefined;
  getBySlug(slug: string): StoredQuestion | undefined;
  /** Non-deleted questions matching the filter, ordered by id. */
  list(filter?: QuestionFilter): StoredQuestion[];
}

// SOLID: I (Interface Segregation) — Why: only the admin service gets write
// access; read and write needs change for different reasons.
export interface QuestionWriter {
  /** Creates version 1. Throws DuplicateSlugError if the slug is taken. */
  create(template: QuestionTemplate, actor: string | null): StoredQuestion;
  /** Saves a new version (previous ones are kept for rollback). */
  update(id: number, template: QuestionTemplate, actor: string | null): StoredQuestion;
  setEnabled(id: number, enabled: boolean, actor: string | null): StoredQuestion;
  /** Soft delete: hidden from list/get, history kept. */
  remove(id: number, actor: string | null): void;
  versions(id: number): QuestionVersion[];
}

// Pattern: Repository — Why: services depend on these interfaces, not on
// SQLite. The SQLite implementation and the in-memory fake are swappable, so
// tests need no database and a future Postgres move touches only one class.
export type QuestionRepository = QuestionReader & QuestionWriter;

export class DuplicateSlugError extends Error {
  constructor(readonly slug: string) {
    super(`a question with slug "${slug}" already exists`);
    this.name = 'DuplicateSlugError';
  }
}

export class QuestionNotFoundError extends Error {
  constructor(readonly id: number) {
    super(`question ${id} not found`);
    this.name = 'QuestionNotFoundError';
  }
}
