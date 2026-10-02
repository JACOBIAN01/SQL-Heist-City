import type { DatabaseSync } from 'node:sqlite';
import {
  DEFAULT_CHALLENGE_SETTINGS,
  DEFAULT_REWARD_TIERS,
  challengeSettingsSchema,
  type ChallengeSettings,
  type TierRange,
} from '@heist/shared';

// SOLID: I + D — Why: game code needs to *read* tunable numbers and nothing
// else; depending on this tiny interface lets tests pass fixed values and lets
// the admin-backed SQLite source change without touching game code.
export interface SettingsReader {
  challengeSettings(): ChallengeSettings;
  /** Tier range for a reward key, or undefined if the reward is unknown. */
  rewardTiers(rewardKey: string): TierRange | undefined;
}

/** Fixed settings, for tests and tools. */
export class StaticSettings implements SettingsReader {
  constructor(
    private readonly challenges: ChallengeSettings = DEFAULT_CHALLENGE_SETTINGS,
    private readonly tiers: Readonly<Record<string, TierRange>> = DEFAULT_REWARD_TIERS,
  ) {}

  challengeSettings(): ChallengeSettings {
    return this.challenges;
  }

  rewardTiers(rewardKey: string): TierRange | undefined {
    return this.tiers[rewardKey];
  }
}

export const CHALLENGE_SETTINGS_KEY = 'challenges';

/**
 * Reads admin overrides from SQLite on top of the shared defaults. Invalid
 * stored values fall back to defaults rather than breaking a live match.
 */
export class SqliteSettingsReader implements SettingsReader {
  constructor(private readonly db: DatabaseSync) {}

  challengeSettings(): ChallengeSettings {
    const row = this.db
      .prepare('SELECT value_json FROM settings WHERE key = ?')
      .get(CHALLENGE_SETTINGS_KEY) as { value_json: string } | undefined;
    if (!row) return DEFAULT_CHALLENGE_SETTINGS;
    const parsed = challengeSettingsSchema.safeParse(safeJson(row.value_json));
    return parsed.success ? parsed.data : DEFAULT_CHALLENGE_SETTINGS;
  }

  rewardTiers(rewardKey: string): TierRange | undefined {
    const row = this.db
      .prepare('SELECT tier_min, tier_max FROM reward_map WHERE reward_key = ?')
      .get(rewardKey) as { tier_min: number; tier_max: number } | undefined;
    return row ? { min: row.tier_min, max: row.tier_max } : DEFAULT_REWARD_TIERS[rewardKey];
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
