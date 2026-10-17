import type { PlayerSettings } from '@heist/shared';
import type { PgDatabase } from '../pg/PgDatabase';

export interface StoredSettings {
  readonly settings: PlayerSettings;
  readonly updatedAt: string;
}

// Pattern: Repository — Why: the account service stores a player's settings; tests use memory.
export interface PlayerSettingsStore {
  get(playerId: number): Promise<StoredSettings | undefined>;
  /** Replaces the player's settings. */
  put(playerId: number, settings: PlayerSettings, now?: Date): Promise<StoredSettings>;
  /** Removes them (the database also does this with the account). */
  remove(playerId: number): Promise<void>;
}

export class PgPlayerSettingsStore implements PlayerSettingsStore {
  constructor(private readonly db: PgDatabase) {}

  async get(playerId: number) {
    const row = await this.db.one<{ settings: PlayerSettings; updated_at: Date }>(
      'SELECT settings, updated_at FROM player_settings WHERE player_id = $1',
      [playerId],
    );
    return row ? { settings: row.settings, updatedAt: row.updated_at.toISOString() } : undefined;
  }

  async put(playerId: number, settings: PlayerSettings, now = new Date()) {
    await this.db.query(
      `INSERT INTO player_settings (player_id, settings, updated_at) VALUES ($1, $2, $3)
       ON CONFLICT (player_id) DO UPDATE SET settings = excluded.settings, updated_at = excluded.updated_at`,
      [playerId, JSON.stringify(settings), now],
    );
    return { settings, updatedAt: now.toISOString() };
  }

  async remove(playerId: number) {
    await this.db.query('DELETE FROM player_settings WHERE player_id = $1', [playerId]);
  }
}

export class InMemoryPlayerSettingsStore implements PlayerSettingsStore {
  private readonly rows = new Map<number, StoredSettings>();

  async get(playerId: number) {
    return this.rows.get(playerId);
  }

  async put(playerId: number, settings: PlayerSettings, now = new Date()) {
    const row = { settings, updatedAt: now.toISOString() };
    this.rows.set(playerId, row);
    return row;
  }

  async remove(playerId: number) {
    this.rows.delete(playerId);
  }
}
