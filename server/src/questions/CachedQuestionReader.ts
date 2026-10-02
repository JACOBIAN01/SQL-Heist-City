import type { QuestionFilter, QuestionReader, StoredQuestion } from './QuestionRepository';

// Pattern: Decorator — Why: the game asks for questions on every challenge
// request; caching wraps any QuestionReader without changing it or its
// callers. The admin's reload signal calls invalidate() so edits show up
// on the next request, with no restart.
export class CachedQuestionReader implements QuestionReader {
  private lists = new Map<string, StoredQuestion[]>();

  constructor(private readonly inner: QuestionReader) {}

  getById(id: number): StoredQuestion | undefined {
    return this.inner.getById(id);
  }

  getBySlug(slug: string): StoredQuestion | undefined {
    return this.inner.getBySlug(slug);
  }

  list(filter: QuestionFilter = {}): StoredQuestion[] {
    const key = JSON.stringify([filter.tierMin, filter.tierMax, filter.enabled, filter.topic]);
    let cached = this.lists.get(key);
    if (!cached) {
      cached = this.inner.list(filter);
      this.lists.set(key, cached);
    }
    return cached;
  }

  invalidate(): void {
    this.lists = new Map();
  }
}
