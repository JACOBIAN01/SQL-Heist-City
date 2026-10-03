/** Remembers what a player typed per task, so switching away and back keeps their work. */
// SOLID: D (Dependency Inversion) — Why: the controller only needs get/set/clear.
// Tests use the in-memory store; the game can pick sessionStorage without
// the controller changing.
export interface DraftStore {
  get(taskKey: string): string;
  set(taskKey: string, text: string): void;
  clear(taskKey: string): void;
}

export class MemoryDraftStore implements DraftStore {
  private readonly drafts = new Map<string, string>();

  get(taskKey: string): string {
    return this.drafts.get(taskKey) ?? '';
  }

  set(taskKey: string, text: string): void {
    if (text === '') this.drafts.delete(taskKey);
    else this.drafts.set(taskKey, text);
  }

  clear(taskKey: string): void {
    this.drafts.delete(taskKey);
  }
}

/**
 * Survives a page reload (sessionStorage). Storage can be unavailable or full
 * (private mode, quota), so every access is guarded and falls back to memory.
 */
export class StorageDraftStore implements DraftStore {
  private readonly fallback = new MemoryDraftStore();

  constructor(
    private readonly storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>,
    private readonly prefix = 'heist-draft:',
  ) {}

  get(taskKey: string): string {
    try {
      return this.storage.getItem(this.prefix + taskKey) ?? this.fallback.get(taskKey);
    } catch {
      return this.fallback.get(taskKey);
    }
  }

  set(taskKey: string, text: string): void {
    this.fallback.set(taskKey, text);
    try {
      if (text === '') this.storage.removeItem(this.prefix + taskKey);
      else this.storage.setItem(this.prefix + taskKey, text);
    } catch {
      // Memory copy above still holds the draft for this visit.
    }
  }

  clear(taskKey: string): void {
    this.fallback.clear(taskKey);
    try {
      this.storage.removeItem(this.prefix + taskKey);
    } catch {
      // Nothing to do.
    }
  }
}
