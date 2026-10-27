import type { PgDatabase } from '../pg/PgDatabase';

// Pattern: Repository — Why: the match records which chips a student found; PostgreSQL in
// production, memory in tests, one contract for both.
export interface CollectionStore {
  /** The chips a student has found (keys such as `heist-city:7`). */
  found(playerId: number): Promise<ReadonlySet<string>>;
  /** Records a find; false if it was already recorded. */
  add(playerId: number, chip: string): Promise<boolean>;
  remove(playerId: number): Promise<void>;
}

export class PgCollectionStore implements CollectionStore {
  constructor(private readonly db: PgDatabase) {}

  async found(playerId: number) {
    const rows = await this.db.query<{ chip: string }>(
      'SELECT chip FROM player_collectibles WHERE player_id = $1',
      [playerId],
    );
    return new Set(rows.map((r) => r.chip));
  }

  async add(playerId: number, chip: string) {
    const rows = await this.db.query(
      `INSERT INTO player_collectibles (player_id, chip) VALUES ($1, $2)
       ON CONFLICT DO NOTHING RETURNING chip`,
      [playerId, chip],
    );
    return rows.length > 0;
  }

  async remove(playerId: number) {
    await this.db.query('DELETE FROM player_collectibles WHERE player_id = $1', [playerId]);
  }
}

export class InMemoryCollectionStore implements CollectionStore {
  private readonly rows = new Map<number, Set<string>>();

  async found(playerId: number) {
    return new Set(this.rows.get(playerId) ?? []);
  }

  async add(playerId: number, chip: string) {
    const set = this.rows.get(playerId) ?? new Set<string>();
    this.rows.set(playerId, set);
    if (set.has(chip)) return false;
    set.add(chip);
    return true;
  }

  async remove(playerId: number) {
    this.rows.delete(playerId);
  }
}
