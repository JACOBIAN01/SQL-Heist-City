import type { PgDatabase } from '../pg/PgDatabase';

export interface StoredProgress {
  readonly learningXp: number;
  readonly playXp: number;
}

export const NO_PROGRESS: StoredProgress = { learningXp: 0, playXp: 0 };

// Pattern: Repository — Why: the match adds XP as things happen and the account service reads it;
// PostgreSQL in production, memory in tests, one contract for both.
export interface ProgressStore {
  get(playerId: number): Promise<StoredProgress>;
  /** Adds to a player's XP. Additive, so two matches writing at once never overwrite each other. */
  add(playerId: number, delta: Partial<StoredProgress>): Promise<StoredProgress>;
  /** XP earned in each season so far, by season id. */
  seasonXp(playerId: number): Promise<Record<string, number>>;
  /** Adds to a player's XP for a season (additive). */
  addSeason(playerId: number, seasonId: string, xp: number): Promise<void>;
  /** Removes it (the database also does this with the account). */
  remove(playerId: number): Promise<void>;
}

interface Row {
  learning_xp: string | number;
  play_xp: string | number;
  [column: string]: unknown;
}
const fromRow = (r: Row): StoredProgress => ({
  learningXp: Number(r.learning_xp),
  playXp: Number(r.play_xp),
});

export class PgProgressStore implements ProgressStore {
  constructor(private readonly db: PgDatabase) {}

  async get(playerId: number) {
    const row = await this.db.one<Row>(
      'SELECT learning_xp, play_xp FROM player_progress WHERE player_id = $1',
      [playerId],
    );
    return row ? fromRow(row) : NO_PROGRESS;
  }

  async add(playerId: number, delta: Partial<StoredProgress>) {
    const row = await this.db.one<Row>(
      `INSERT INTO player_progress (player_id, learning_xp, play_xp) VALUES ($1, $2, $3)
       ON CONFLICT (player_id) DO UPDATE SET
         learning_xp = player_progress.learning_xp + excluded.learning_xp,
         play_xp = player_progress.play_xp + excluded.play_xp,
         updated_at = now()
       RETURNING learning_xp, play_xp`,
      [playerId, delta.learningXp ?? 0, delta.playXp ?? 0],
    );
    return fromRow(row as Row);
  }

  async seasonXp(playerId: number) {
    const rows = await this.db.query<{ season: string; xp: string }>(
      'SELECT season, xp FROM player_season_xp WHERE player_id = $1',
      [playerId],
    );
    return Object.fromEntries(rows.map((r) => [r.season, Number(r.xp)]));
  }

  async addSeason(playerId: number, seasonId: string, xp: number) {
    await this.db.query(
      `INSERT INTO player_season_xp (player_id, season, xp) VALUES ($1, $2, $3)
       ON CONFLICT (player_id, season) DO UPDATE SET xp = player_season_xp.xp + excluded.xp`,
      [playerId, seasonId, xp],
    );
  }

  async remove(playerId: number) {
    await this.db.query('DELETE FROM player_progress WHERE player_id = $1', [playerId]);
    await this.db.query('DELETE FROM player_season_xp WHERE player_id = $1', [playerId]);
  }
}

export class InMemoryProgressStore implements ProgressStore {
  private readonly rows = new Map<number, StoredProgress>();
  private readonly seasons = new Map<string, number>();

  async get(playerId: number) {
    return this.rows.get(playerId) ?? NO_PROGRESS;
  }

  async add(playerId: number, delta: Partial<StoredProgress>) {
    const was = this.rows.get(playerId) ?? NO_PROGRESS;
    const next = {
      learningXp: was.learningXp + (delta.learningXp ?? 0),
      playXp: was.playXp + (delta.playXp ?? 0),
    };
    this.rows.set(playerId, next);
    return next;
  }

  async seasonXp(playerId: number) {
    const out: Record<string, number> = {};
    for (const [key, xp] of this.seasons)
      if (key.startsWith(`${playerId}|`)) out[key.slice(String(playerId).length + 1)] = xp;
    return out;
  }

  async addSeason(playerId: number, seasonId: string, xp: number) {
    const key = `${playerId}|${seasonId}`;
    this.seasons.set(key, (this.seasons.get(key) ?? 0) + xp);
  }

  async remove(playerId: number) {
    this.rows.delete(playerId);
    for (const key of [...this.seasons.keys()])
      if (key.startsWith(`${playerId}|`)) this.seasons.delete(key);
  }
}
