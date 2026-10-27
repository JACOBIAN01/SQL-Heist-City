import type { PgDatabase } from '../pg/PgDatabase';

// Pattern: Repository — Why: the match reads and writes a student's safehouse upgrades; PostgreSQL
// in production, memory in tests, one contract for both.
export interface UpgradeStore {
  /** Level owned of each upgrade the student has bought. */
  levels(playerId: number): Promise<Readonly<Record<string, number>>>;
  setLevel(playerId: number, upgrade: string, level: number): Promise<void>;
  remove(playerId: number): Promise<void>;
}

export class PgUpgradeStore implements UpgradeStore {
  constructor(private readonly db: PgDatabase) {}

  async levels(playerId: number) {
    const rows = await this.db.query<{ upgrade: string; level: number }>(
      'SELECT upgrade, level FROM player_upgrades WHERE player_id = $1',
      [playerId],
    );
    return Object.fromEntries(rows.map((r) => [r.upgrade, Number(r.level)]));
  }

  async setLevel(playerId: number, upgrade: string, level: number) {
    await this.db.query(
      `INSERT INTO player_upgrades (player_id, upgrade, level) VALUES ($1, $2, $3)
       ON CONFLICT (player_id, upgrade) DO UPDATE SET level = excluded.level`,
      [playerId, upgrade, level],
    );
  }

  async remove(playerId: number) {
    await this.db.query('DELETE FROM player_upgrades WHERE player_id = $1', [playerId]);
  }
}

export class InMemoryUpgradeStore implements UpgradeStore {
  private readonly rows = new Map<number, Record<string, number>>();

  async levels(playerId: number) {
    return { ...(this.rows.get(playerId) ?? {}) };
  }

  async setLevel(playerId: number, upgrade: string, level: number) {
    this.rows.set(playerId, { ...(this.rows.get(playerId) ?? {}), [upgrade]: level });
  }

  async remove(playerId: number) {
    this.rows.delete(playerId);
  }
}
