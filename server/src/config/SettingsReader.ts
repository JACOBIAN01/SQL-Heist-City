import type { DatabaseSync } from 'node:sqlite';
import {
  DEFAULT_CHALLENGE_SETTINGS,
  DEFAULT_COMBAT_SETTINGS,
  combatSettingsSchema,
  type CombatSettings,
  DEFAULT_ATMOSPHERE_SETTINGS,
  DEFAULT_CITY_SETTINGS,
  DEFAULT_HEIST_SETTINGS,
  DEFAULT_ANALYTICS_SETTINGS,
  DEFAULT_DIALECT_SETTINGS,
  DEFAULT_PRIVACY_SETTINGS,
  privacySettingsSchema,
  type PrivacySettings,
  dialectSettingsSchema,
  type DialectSettings,
  analyticsSettingsSchema,
  type AnalyticsSettings,
  DEFAULT_NAME_RULES,
  DEFAULT_REWARD_ICONS,
  DEFAULT_VEHICLE_SETTINGS,
  nameRulesSchema,
  type NameRules,
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
  /** How learning is measured: marks, hint penalty, thresholds, target profile. */
  analyticsSettings(): AnalyticsSettings;
  /** The dialect packs: notes on how other SQL dialects differ from SQLite. */
  dialectSettings(): DialectSettings;
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
    private readonly analytics: AnalyticsSettings = DEFAULT_ANALYTICS_SETTINGS,
    private readonly dialects: DialectSettings = DEFAULT_DIALECT_SETTINGS,
  ) {}

  analyticsSettings(): AnalyticsSettings {
    return this.analytics;
  }

  dialectSettings(): DialectSettings {
    return this.dialects;
  }

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
export const NAME_RULES_KEY = 'names';
export const ANALYTICS_SETTINGS_KEY = 'analytics';
export const DIALECT_SETTINGS_KEY = 'dialects';
export const PRIVACY_SETTINGS_KEY = 'privacy';

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

/** A stored section, or its defaults when missing or no longer valid. */
function sectionFrom<T>(
  raw: unknown,
  schema: { safeParse(v: unknown): { success: true; data: T } | { success: false } },
  fallback: T,
): T {
  if (raw === undefined) return fallback;
  const parsed = schema.safeParse(raw);
  return parsed.success ? parsed.data : fallback;
}

/**
 * How each stored settings section turns into values: stored JSON over the
 * defaults, and the defaults again when the stored value is missing or invalid.
 * The game's reader and the admin's editor both use these, so they cannot disagree.
 */
export const settingsParsers = {
  challengeFrom: (raw: unknown): ChallengeSettings =>
    sectionFrom(raw, challengeSettingsSchema, DEFAULT_CHALLENGE_SETTINGS),
  heistFrom: (raw: unknown): HeistSettings =>
    sectionFrom(raw, heistSettingsSchema, DEFAULT_HEIST_SETTINGS),
  combatFrom: (raw: unknown): CombatSettings =>
    raw === undefined ? DEFAULT_COMBAT_SETTINGS : combatFrom(raw),
  tutorialFrom: (raw: unknown): TutorialSettings =>
    sectionFrom(raw, tutorialSettingsSchema, DEFAULT_TUTORIAL_SETTINGS),
  vehicleFrom: (raw: unknown): VehicleSettings =>
    sectionFrom(raw, vehicleSettingsSchema, DEFAULT_VEHICLE_SETTINGS),
  atmosphereFrom: (raw: unknown): AtmosphereSettings =>
    sectionFrom(raw, atmosphereSettingsSchema, DEFAULT_ATMOSPHERE_SETTINGS),
  cityFrom: (raw: unknown): CitySettings =>
    sectionFrom(raw, citySettingsSchema, DEFAULT_CITY_SETTINGS),
  analyticsFrom: (raw: unknown): AnalyticsSettings =>
    sectionFrom(raw, analyticsSettingsSchema, DEFAULT_ANALYTICS_SETTINGS),
  namesFrom: (raw: unknown): NameRules => sectionFrom(raw, nameRulesSchema, DEFAULT_NAME_RULES),
  privacyFrom: (raw: unknown): PrivacySettings =>
    sectionFrom(raw, privacySettingsSchema, DEFAULT_PRIVACY_SETTINGS),
  dialectsFrom: (raw: unknown): DialectSettings =>
    sectionFrom(raw, dialectSettingsSchema, DEFAULT_DIALECT_SETTINGS),
  rewardIconsFrom: (raw: unknown): RewardIcons =>
    sectionFrom(raw, rewardIconsSchema, DEFAULT_REWARD_ICONS),
} as const;

/**
 * Reads admin overrides from SQLite on top of the shared defaults. Invalid
 * stored values fall back to defaults rather than breaking a live match.
 */
export class SqliteSettingsReader implements SettingsReader {
  constructor(private readonly db: DatabaseSync) {}

  challengeSettings(): ChallengeSettings {
    return settingsParsers.challengeFrom(this.raw(CHALLENGE_SETTINGS_KEY));
  }

  heistSettings(): HeistSettings {
    return settingsParsers.heistFrom(this.raw(HEIST_SETTINGS_KEY));
  }

  combatSettings(): CombatSettings {
    return settingsParsers.combatFrom(this.raw(COMBAT_SETTINGS_KEY));
  }

  tutorialSettings(): TutorialSettings {
    return settingsParsers.tutorialFrom(this.raw(TUTORIAL_SETTINGS_KEY));
  }

  vehicleSettings(): VehicleSettings {
    return settingsParsers.vehicleFrom(this.raw(VEHICLE_SETTINGS_KEY));
  }

  atmosphereSettings(): AtmosphereSettings {
    return settingsParsers.atmosphereFrom(this.raw(ATMOSPHERE_SETTINGS_KEY));
  }

  analyticsSettings(): AnalyticsSettings {
    return settingsParsers.analyticsFrom(this.raw(ANALYTICS_SETTINGS_KEY));
  }

  dialectSettings(): DialectSettings {
    return settingsParsers.dialectsFrom(this.raw(DIALECT_SETTINGS_KEY));
  }

  rewardIcons(): RewardIcons {
    return settingsParsers.rewardIconsFrom(this.raw(REWARD_ICONS_KEY));
  }

  citySettings(): CitySettings {
    return settingsParsers.cityFrom(this.raw(CITY_SETTINGS_KEY));
  }

  rewardTiers(rewardKey: string): TierRange | undefined {
    const row = this.db
      .prepare('SELECT tier_min, tier_max FROM reward_map WHERE reward_key = ?')
      .get(rewardKey) as { tier_min: number; tier_max: number } | undefined;
    return row ? { min: row.tier_min, max: row.tier_max } : DEFAULT_REWARD_TIERS[rewardKey];
  }

  private raw(key: string): unknown {
    const row = this.db.prepare('SELECT value_json FROM settings WHERE key = ?').get(key) as
      { value_json: string } | undefined;
    return row ? safeJson(row.value_json) : undefined;
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
