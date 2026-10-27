import type { PgDatabase } from '../pg/PgDatabase';

// Pattern: Repository — Why: the match reads and writes how far a student is through the story;
// PostgreSQL in production, memory in tests, one contract for both.
export interface StoryStore {
  /** Steps finished in each chain, by bank (`bank-3` → 2). */
  steps(playerId: number): Promise<Readonly<Record<string, number>>>;
  setStep(playerId: number, chain: string, step: number): Promise<void>;
  remove(playerId: number): Promise<void>;
}

export class PgStoryStore implements StoryStore {
  constructor(private readonly db: PgDatabase) {}

  async steps(playerId: number) {
    const rows = await this.db.query<{ chain: string; step: number }>(
      'SELECT chain, step FROM player_story WHERE player_id = $1',
      [playerId],
    );
    return Object.fromEntries(rows.map((r) => [r.chain, Number(r.step)]));
  }

  async setStep(playerId: number, chain: string, step: number) {
    await this.db.query(
      `INSERT INTO player_story (player_id, chain, step) VALUES ($1, $2, $3)
       ON CONFLICT (player_id, chain) DO UPDATE SET step = excluded.step`,
      [playerId, chain, step],
    );
  }

  async remove(playerId: number) {
    await this.db.query('DELETE FROM player_story WHERE player_id = $1', [playerId]);
  }
}

export class InMemoryStoryStore implements StoryStore {
  private readonly rows = new Map<number, Record<string, number>>();

  async steps(playerId: number) {
    return { ...(this.rows.get(playerId) ?? {}) };
  }

  async setStep(playerId: number, chain: string, step: number) {
    this.rows.set(playerId, { ...(this.rows.get(playerId) ?? {}), [chain]: step });
  }

  async remove(playerId: number) {
    this.rows.delete(playerId);
  }
}
