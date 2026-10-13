import type { DatabaseSync } from 'node:sqlite';
import type { PgDatabase } from '../pg/PgDatabase';

export interface RewardChange {
  readonly key: string;
  readonly override: { readonly min: number; readonly max: number } | null;
}

export interface RewardOverride {
  readonly key: string;
  readonly min: number;
  readonly max: number;
}

// Pattern: Repository (async) — Why: the admin edits gameplay numbers through this, on SQLite
// in development and PostgreSQL in production; the game reads a snapshot (SettingsReader).
export interface SettingsStore {
  /** The stored JSON of a settings key, or undefined. */
  get(key: string): Promise<unknown>;
  put(key: string, value: unknown): Promise<void>;
  rewardOverrides(): Promise<RewardOverride[]>;
  /** All reward changes land together or not at all; `null` removes an override. */
  applyRewards(changes: readonly RewardChange[]): Promise<void>;
  questionSlugExists(slug: string): Promise<boolean>;
}

const safeJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

export class SqliteSettingsStore implements SettingsStore {
  constructor(private readonly db: DatabaseSync) {}

  async get(key: string): Promise<unknown> {
    const row = this.db.prepare('SELECT value_json FROM settings WHERE key = ?').get(key) as
      { value_json: string } | undefined;
    return row ? safeJson(row.value_json) : undefined;
  }

  async put(key: string, value: unknown): Promise<void> {
    this.db
      .prepare(
        'INSERT INTO settings (key, value_json) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json',
      )
      .run(key, JSON.stringify(value));
  }

  async rewardOverrides(): Promise<RewardOverride[]> {
    const rows = this.db
      .prepare('SELECT reward_key, tier_min, tier_max FROM reward_map')
      .all() as unknown as { reward_key: string; tier_min: number; tier_max: number }[];
    return rows.map((r) => ({ key: r.reward_key, min: r.tier_min, max: r.tier_max }));
  }

  async applyRewards(changes: readonly RewardChange[]): Promise<void> {
    this.db.exec('BEGIN');
    try {
      for (const { key, override } of changes) {
        if (override === null) {
          this.db.prepare('DELETE FROM reward_map WHERE reward_key = ?').run(key);
        } else {
          this.db
            .prepare(
              `INSERT INTO reward_map (reward_key, tier_min, tier_max) VALUES (?, ?, ?)
               ON CONFLICT (reward_key) DO UPDATE SET tier_min = excluded.tier_min, tier_max = excluded.tier_max`,
            )
            .run(key, override.min, override.max);
        }
      }
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  async questionSlugExists(slug: string): Promise<boolean> {
    return !!this.db
      .prepare('SELECT 1 FROM questions WHERE slug = ? AND deleted_at IS NULL')
      .get(slug);
  }
}

export class PgSettingsStore implements SettingsStore {
  constructor(private readonly db: PgDatabase) {}

  async get(key: string): Promise<unknown> {
    return (
      await this.db.one<{ value_json: unknown }>('SELECT value_json FROM settings WHERE key = $1', [
        key,
      ])
    )?.value_json;
  }

  async put(key: string, value: unknown): Promise<void> {
    await this.db.query(
      `INSERT INTO settings (key, value_json) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json`,
      [key, JSON.stringify(value)],
    );
  }

  async rewardOverrides(): Promise<RewardOverride[]> {
    const rows = await this.db.query<{ reward_key: string; tier_min: number; tier_max: number }>(
      'SELECT reward_key, tier_min, tier_max FROM reward_map',
    );
    return rows.map((r) => ({ key: r.reward_key, min: r.tier_min, max: r.tier_max }));
  }

  async applyRewards(changes: readonly RewardChange[]): Promise<void> {
    await this.db.tx(async (tx) => {
      for (const { key, override } of changes) {
        if (override === null) {
          await tx.query('DELETE FROM reward_map WHERE reward_key = $1', [key]);
        } else {
          await tx.query(
            `INSERT INTO reward_map (reward_key, tier_min, tier_max) VALUES ($1, $2, $3)
             ON CONFLICT (reward_key) DO UPDATE SET tier_min = excluded.tier_min, tier_max = excluded.tier_max`,
            [key, override.min, override.max],
          );
        }
      }
    });
  }

  async questionSlugExists(slug: string): Promise<boolean> {
    return !!(await this.db.one('SELECT 1 FROM questions WHERE slug = $1 AND deleted_at IS NULL', [
      slug,
    ]));
  }
}
