import type { DatabaseSync } from 'node:sqlite';
import {
  DEFAULT_CHALLENGE_SETTINGS,
  DEFAULT_COMBAT_SETTINGS,
  combatSettingsSchema,
  type CombatSettings,
  DEFAULT_ATMOSPHERE_SETTINGS,
  DEFAULT_CITY_SETTINGS,
  DEFAULT_HEIST_SETTINGS,
  DEFAULT_REWARD_ICONS,
  DEFAULT_VEHICLE_SETTINGS,
  rewardIconsSchema,
  type RewardIcons,
  atmosphereSettingsSchema,
  citySettingsSchema,
  vehicleSettingsSchema,
  type AtmosphereSettings,
  type CitySettings,
  type VehicleSettings,
  type WorldSettings,
  DEFAULT_REWARD_TIERS,
  challengeSettingsSchema,
  heistSettingsSchema,
  type HeistSettings,
  type ChallengeSettings,
  type TierRange,
  DEFAULT_TUTORIAL_SETTINGS,
  tutorialSettingsSchema,
  type TutorialSettings,
} from '@heist/shared';

// SOLID: I + D — Why: game code needs to *read* tunable numbers and nothing
// else; depending on this tiny interface lets tests pass fixed values and lets
// the admin-backed SQLite source change without touching game code.
export interface SettingsReader {
  challengeSettings(): ChallengeSettings;
  heistSettings(): HeistSettings;
  /** Guns and damage rules; stored guns override the defaults one by one. */
  combatSettings(): CombatSettings;
  /** Cars: speeds, handling, mass and run-over damage. */
  vehicleSettings(): VehicleSettings;
  /** Time of day. */
  atmosphereSettings(): AtmosphereSettings;
  /** Which picture each reward shows. */
  rewardIcons(): RewardIcons;
  /** How the city is generated; read when a match is created. */
  citySettings(): CitySettings;
  /** The tutorial: room limits and the fixed question of each task. */
  tutorialSettings(): TutorialSettings;
  /** Tier range for a reward key, or undefined if the reward is unknown. */
  rewardTiers(rewardKey: string): TierRange | undefined;
}

/** Fixed settings, for tests and tools. */
export class StaticSettings implements SettingsReader {
  constructor(
    private readonly challenges: ChallengeSettings = DEFAULT_CHALLENGE_SETTINGS,
    private readonly tiers: Readonly<Record<string, TierRange>> = DEFAULT_REWARD_TIERS,
    private readonly heist: HeistSettings = DEFAULT_HEIST_SETTINGS,
    private readonly combat: CombatSettings = DEFAULT_COMBAT_SETTINGS,
    private readonly tutorial: TutorialSettings = DEFAULT_TUTORIAL_SETTINGS,
    private readonly vehicles: VehicleSettings = DEFAULT_VEHICLE_SETTINGS,
    private readonly atmosphere: AtmosphereSettings = DEFAULT_ATMOSPHERE_SETTINGS,
    private readonly city: CitySettings = DEFAULT_CITY_SETTINGS,
    private readonly icons: RewardIcons = DEFAULT_REWARD_ICONS,
  ) {}

  rewardIcons(): RewardIcons {
    return this.icons;
  }

  vehicleSettings(): VehicleSettings {
    return this.vehicles;
  }

  atmosphereSettings(): AtmosphereSettings {
    return this.atmosphere;
  }

  citySettings(): CitySettings {
    return this.city;
  }

  tutorialSettings(): TutorialSettings {
    return this.tutorial;
  }

  heistSettings(): HeistSettings {
    return this.heist;
  }

  combatSettings(): CombatSettings {
    return this.combat;
  }

  challengeSettings(): ChallengeSettings {
    return this.challenges;
  }

  rewardTiers(rewardKey: string): TierRange | undefined {
    return this.tiers[rewardKey];
  }
}

export const CHALLENGE_SETTINGS_KEY = 'challenges';
export const HEIST_SETTINGS_KEY = 'heist';
export const COMBAT_SETTINGS_KEY = 'combat';
export const TUTORIAL_SETTINGS_KEY = 'tutorial';
export const VEHICLE_SETTINGS_KEY = 'vehicles';
export const ATMOSPHERE_SETTINGS_KEY = 'atmosphere';
export const CITY_SETTINGS_KEY = 'city';
export const REWARD_ICONS_KEY = 'reward_icons';

/** What a match re-reads each round. */
export function worldSettingsFrom(reader: SettingsReader): WorldSettings {
  return {
    heist: reader.heistSettings(),
    vehicles: reader.vehicleSettings(),
    atmosphere: reader.atmosphereSettings(),
    rewardIcons: reader.rewardIcons(),
  };
}

/**
 * Stored combat settings over the defaults. Guns merge one by one, so an
 * admin who retunes the SMG keeps every other gun (and a gun added in code
 * later appears with its defaults).
 */
export function combatFrom(stored: unknown): CombatSettings {
  const parsed = combatSettingsSchema.safeParse(stored ?? {});
  if (!parsed.success) return DEFAULT_COMBAT_SETTINGS;
  const given = (stored as { weapons?: object } | undefined)?.weapons ?? {};
  return {
    ...parsed.data,
    weapons: {
      ...DEFAULT_COMBAT_SETTINGS.weapons,
      ...Object.fromEntries(Object.keys(given).map((id) => [id, parsed.data.weapons[id]])),
    } as CombatSettings['weapons'],
  };
}

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

  heistSettings(): HeistSettings {
    const row = this.db
      .prepare('SELECT value_json FROM settings WHERE key = ?')
      .get(HEIST_SETTINGS_KEY) as { value_json: string } | undefined;
    if (!row) return DEFAULT_HEIST_SETTINGS;
    const parsed = heistSettingsSchema.safeParse(safeJson(row.value_json));
    return parsed.success ? parsed.data : DEFAULT_HEIST_SETTINGS;
  }

  combatSettings(): CombatSettings {
    const row = this.db
      .prepare('SELECT value_json FROM settings WHERE key = ?')
      .get(COMBAT_SETTINGS_KEY) as { value_json: string } | undefined;
    return row ? combatFrom(safeJson(row.value_json)) : DEFAULT_COMBAT_SETTINGS;
  }

  tutorialSettings(): TutorialSettings {
    const row = this.db
      .prepare('SELECT value_json FROM settings WHERE key = ?')
      .get(TUTORIAL_SETTINGS_KEY) as { value_json: string } | undefined;
    if (!row) return DEFAULT_TUTORIAL_SETTINGS;
    const parsed = tutorialSettingsSchema.safeParse(safeJson(row.value_json));
    return parsed.success ? parsed.data : DEFAULT_TUTORIAL_SETTINGS;
  }

  vehicleSettings(): VehicleSettings {
    return this.stored(VEHICLE_SETTINGS_KEY, vehicleSettingsSchema, DEFAULT_VEHICLE_SETTINGS);
  }

  atmosphereSettings(): AtmosphereSettings {
    return this.stored(
      ATMOSPHERE_SETTINGS_KEY,
      atmosphereSettingsSchema,
      DEFAULT_ATMOSPHERE_SETTINGS,
    );
  }

  rewardIcons(): RewardIcons {
    return this.stored(REWARD_ICONS_KEY, rewardIconsSchema, DEFAULT_REWARD_ICONS);
  }

  citySettings(): CitySettings {
    return this.stored(CITY_SETTINGS_KEY, citySettingsSchema, DEFAULT_CITY_SETTINGS);
  }

  /** A stored section, or its defaults when missing or no longer valid. */
  private stored<T>(
    key: string,
    schema: { safeParse(v: unknown): { success: true; data: T } | { success: false } },
    fallback: T,
  ): T {
    const row = this.db.prepare('SELECT value_json FROM settings WHERE key = ?').get(key) as
      { value_json: string } | undefined;
    if (!row) return fallback;
    const parsed = schema.safeParse(safeJson(row.value_json));
    return parsed.success ? parsed.data : fallback;
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
