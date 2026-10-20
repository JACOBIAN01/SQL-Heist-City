/**
 * Counts each player's run of clean answers within a round (Phase 26.4). Keyed by the match's
 * player key, which is never reused, so a new life or a new join cannot inherit a run.
 */
export class StreakKeeper {
  private readonly runs = new Map<string, number>();

  /** A clean answer: the run grows; returns its new length. */
  solved(key: string): number {
    const n = (this.runs.get(key) ?? 0) + 1;
    this.runs.set(key, n);
    return n;
  }

  /** A wrong submit or a death. */
  broke(key: string): void {
    this.runs.delete(key);
  }

  get(key: string): number {
    return this.runs.get(key) ?? 0;
  }

  /** A new round starts everyone at nothing. */
  reset(): void {
    this.runs.clear();
  }
}
