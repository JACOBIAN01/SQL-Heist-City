import type { LookChoice } from '@heist/shared';
import type { PgDatabase } from '../pg/PgDatabase';

// Pattern: Repository — Why: the match reads and writes what a student wears; PostgreSQL in
// production, memory in tests, one contract for both.
export interface LoadoutStore {
  get(playerId: number): Promise<LookChoice>;
  put(playerId: number, choice: LookChoice): Promise<void>;
  /** Removes it (the database also does this with the account). */
  remove(playerId: number): Promise<void>;
}

export class PgLoadoutStore implements LoadoutStore {
  constructor(private readonly db: PgDatabase) {}

  async get(playerId: number) {
    const row = await this.db.one<{ choice: LookChoice }>(
      'SELECT choice FROM player_loadout WHERE player_id = $1',
      [playerId],
    );
    return row?.choice ?? {};
  }

  async put(playerId: number, choice: LookChoice) {
    await this.db.query(
      `INSERT INTO player_loadout (player_id, choice) VALUES ($1, $2)
       ON CONFLICT (player_id) DO UPDATE SET choice = excluded.choice, updated_at = now()`,
      [playerId, JSON.stringify(choice)],
    );
  }

  async remove(playerId: number) {
    await this.db.query('DELETE FROM player_loadout WHERE player_id = $1', [playerId]);
  }
}

export class InMemoryLoadoutStore implements LoadoutStore {
  private readonly rows = new Map<number, LookChoice>();

  async get(playerId: number) {
    return this.rows.get(playerId) ?? {};
  }

  async put(playerId: number, choice: LookChoice) {
    this.rows.set(playerId, choice);
  }

  async remove(playerId: number) {
    this.rows.delete(playerId);
  }
}
