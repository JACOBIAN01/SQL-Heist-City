import type { DatabaseSync } from 'node:sqlite';
import {
  DEFAULT_CHALLENGE_SETTINGS,
  DEFAULT_REWARD_TIERS,
  challengeSettingsSchema,
  type AdminUser,
  type ChallengeSettings,
  type RewardMapUpdate,
  type RewardTierEntry,
} from '@heist/shared';
import { CHALLENGE_SETTINGS_KEY, SqliteSettingsReader } from '@heist/server/config/SettingsReader';
import { HttpError } from '../http/errors';
import type { AdminEventBus } from '../events/AdminEvents';

/** Writes gameplay settings; reads go through the same reader the game uses. */
export class SettingsService {
  private readonly reader: SqliteSettingsReader;

  constructor(
    private readonly db: DatabaseSync,
    private readonly events: AdminEventBus,
  ) {
    this.reader = new SqliteSettingsReader(db);
  }

  challengeSettings(): { current: ChallengeSettings; defaults: ChallengeSettings } {
    return { current: this.reader.challengeSettings(), defaults: DEFAULT_CHALLENGE_SETTINGS };
  }

  /** Merges a partial change into the current values; the full result is validated. */
  updateChallengeSettings(changes: unknown, actor: AdminUser): ChallengeSettings {
    const before = this.reader.challengeSettings();
    const parsed = challengeSettingsSchema.safeParse({ ...before, ...(changes as object) });
    if (!parsed.success) {
      throw new HttpError(
        400,
        'validation_failed',
        'Some settings are invalid',
        parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      );
    }
    this.db
      .prepare(
        'INSERT INTO settings (key, value_json) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json',
      )
      .run(CHALLENGE_SETTINGS_KEY, JSON.stringify(parsed.data));
    this.events.publish({
      type: 'settings_changed',
      key: CHALLENGE_SETTINGS_KEY,
      actor: { id: actor.id, email: actor.email },
      before,
      after: parsed.data,
    });
    return parsed.data;
  }

  rewardMap(): RewardTierEntry[] {
    const overrides = new Set(
      (this.db.prepare('SELECT reward_key FROM reward_map').all() as { reward_key: string }[]).map(
        (r) => r.reward_key,
      ),
    );
    return Object.keys(DEFAULT_REWARD_TIERS).map((key) => {
      const tiers = this.reader.rewardTiers(key) as { min: number; max: number };
      return { key, min: tiers.min, max: tiers.max, isDefault: !overrides.has(key) };
    });
  }

  /** Saves overrides; entries equal to the default remove the override. */
  updateRewardMap(update: RewardMapUpdate, actor: AdminUser): RewardTierEntry[] {
    for (const r of update.rewards) {
      if (!(r.key in DEFAULT_REWARD_TIERS))
        throw new HttpError(400, 'unknown_reward', `Unknown reward "${r.key}"`);
      if (r.min > r.max)
        throw new HttpError(400, 'validation_failed', `${r.key}: min must be ≤ max`);
    }
    const before = this.rewardMap();
    this.db.exec('BEGIN');
    try {
      for (const r of update.rewards) {
        const def = DEFAULT_REWARD_TIERS[r.key] as { min: number; max: number };
        if (def.min === r.min && def.max === r.max) {
          this.db.prepare('DELETE FROM reward_map WHERE reward_key = ?').run(r.key);
        } else {
          this.db
            .prepare(
              `INSERT INTO reward_map (reward_key, tier_min, tier_max) VALUES (?, ?, ?)
               ON CONFLICT (reward_key) DO UPDATE SET tier_min = excluded.tier_min, tier_max = excluded.tier_max`,
            )
            .run(r.key, r.min, r.max);
        }
      }
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
    const after = this.rewardMap();
    this.events.publish({
      type: 'settings_changed',
      key: 'reward_map',
      actor: { id: actor.id, email: actor.email },
      before,
      after,
    });
    return after;
  }
}
