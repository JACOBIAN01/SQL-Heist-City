import type { DatabaseSync } from 'node:sqlite';
import {
  DEFAULT_CHALLENGE_SETTINGS,
  DEFAULT_COMBAT_SETTINGS,
  combatSettingsSchema,
  type CombatSettings,
  DEFAULT_REWARD_TIERS,
  challengeSettingsSchema,
  type AdminUser,
  type ChallengeSettings,
  type RewardMapUpdate,
  type RewardTierEntry,
  DEFAULT_ATMOSPHERE_SETTINGS,
  DEFAULT_REWARD_ICONS,
  rewardIconsSchema,
  DEFAULT_CITY_SETTINGS,
  DEFAULT_HEIST_SETTINGS,
  DEFAULT_VEHICLE_SETTINGS,
  atmosphereSettingsSchema,
  citySettingsSchema,
  heistSettingsSchema,
  vehicleSettingsSchema,
  DEFAULT_TUTORIAL_SETTINGS,
  tutorialSettingsSchema,
  type TutorialSettings,
} from '@heist/shared';
import {
  ATMOSPHERE_SETTINGS_KEY,
  CITY_SETTINGS_KEY,
  HEIST_SETTINGS_KEY,
  REWARD_ICONS_KEY,
  VEHICLE_SETTINGS_KEY,
  CHALLENGE_SETTINGS_KEY,
  COMBAT_SETTINGS_KEY,
  SqliteSettingsReader,
  TUTORIAL_SETTINGS_KEY,
} from '@heist/server/config/SettingsReader';
import type { ZodType } from 'zod';
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

  combatSettings(): { current: CombatSettings; defaults: CombatSettings } {
    return { current: this.reader.combatSettings(), defaults: DEFAULT_COMBAT_SETTINGS };
  }

  /**
   * Merges a partial change (top-level numbers, and per gun only the fields
   * given) into the current values; the full result is validated. Applies
   * in matches from their next round.
   */
  updateCombatSettings(changes: unknown, actor: AdminUser): CombatSettings {
    const before = this.reader.combatSettings();
    const given = (changes ?? {}) as Partial<CombatSettings> & {
      weapons?: Record<string, object>;
    };
    if (typeof given !== 'object' || Array.isArray(given))
      throw new HttpError(400, 'validation_failed', 'Combat settings must be an object');
    const weapons: Record<string, unknown> = { ...before.weapons };
    for (const [id, spec] of Object.entries(given.weapons ?? {})) {
      if (!(id in DEFAULT_COMBAT_SETTINGS.weapons))
        throw new HttpError(400, 'unknown_weapon', `Unknown gun "${id}"`);
      weapons[id] = { ...before.weapons[id], ...spec };
    }
    const parsed = combatSettingsSchema.safeParse({ ...before, ...given, weapons });
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
      .run(COMBAT_SETTINGS_KEY, JSON.stringify(parsed.data));
    this.events.publish({
      type: 'settings_changed',
      key: COMBAT_SETTINGS_KEY,
      actor: { id: actor.id, email: actor.email },
      before,
      after: parsed.data,
    });
    return parsed.data;
  }

  tutorialSettings(): { current: TutorialSettings; defaults: TutorialSettings } {
    return { current: this.reader.tutorialSettings(), defaults: DEFAULT_TUTORIAL_SETTINGS };
  }

  /**
   * Merges a partial change (the fixed questions one by one) into the current
   * values. Every fixed question must exist; new tutorials use the change.
   */
  updateTutorialSettings(changes: unknown, actor: AdminUser): TutorialSettings {
    const before = this.reader.tutorialSettings();
    const given = (changes ?? {}) as Partial<TutorialSettings>;
    if (typeof given !== 'object' || Array.isArray(given))
      throw new HttpError(400, 'validation_failed', 'Tutorial settings must be an object');
    const parsed = tutorialSettingsSchema.safeParse({
      ...before,
      ...given,
      questions: { ...before.questions, ...given.questions },
    });
    if (!parsed.success) {
      throw new HttpError(
        400,
        'validation_failed',
        'Some settings are invalid',
        parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      );
    }
    for (const [task, slug] of Object.entries(parsed.data.questions)) {
      const found = this.db
        .prepare('SELECT 1 FROM questions WHERE slug = ? AND deleted_at IS NULL')
        .get(slug);
      if (!found)
        throw new HttpError(400, 'unknown_question', `No question "${slug}" (tutorial ${task})`);
    }
    this.db
      .prepare(
        'INSERT INTO settings (key, value_json) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json',
      )
      .run(TUTORIAL_SETTINGS_KEY, JSON.stringify(parsed.data));
    this.events.publish({
      type: 'settings_changed',
      key: TUTORIAL_SETTINGS_KEY,
      actor: { id: actor.id, email: actor.email },
      before,
      after: parsed.data,
    });
    return parsed.data;
  }

  /** The editable sections that are plain numbers: key → what the admin may change. */
  section(name: SectionName): { current: object; defaults: object } {
    const spec = SECTIONS[name];
    return { current: spec.read(this.reader), defaults: spec.defaults };
  }

  /**
   * Merges a partial change into the section (nested objects field by field,
   * so retuning one car or one bank's loot keeps the rest) and validates the
   * whole. Cars, heist rules and the sky reach running matches at their next
   * round; a new city only applies to matches created afterwards.
   */
  updateSection(name: SectionName, changes: unknown, actor: AdminUser): object {
    const spec = SECTIONS[name];
    if (typeof changes !== 'object' || changes === null || Array.isArray(changes))
      throw new HttpError(400, 'validation_failed', `${name} settings must be an object`);
    const before = spec.read(this.reader);
    const parsed = spec.schema.safeParse(mergeDeep(before, changes));
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
      .run(spec.key, JSON.stringify(parsed.data));
    this.events.publish({
      type: 'settings_changed',
      key: spec.key,
      actor: { id: actor.id, email: actor.email },
      before,
      after: parsed.data,
    });
    return parsed.data as object;
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

export type SectionName = 'heist' | 'vehicles' | 'atmosphere' | 'city' | 'rewardIcons';
export const SECTION_NAMES: readonly SectionName[] = [
  'heist',
  'vehicles',
  'atmosphere',
  'city',
  'rewardIcons',
];

interface SectionSpec {
  readonly key: string;
  readonly schema: ZodType;
  readonly defaults: object;
  readonly read: (reader: SqliteSettingsReader) => object;
}

// Pattern: Registry — Why: a new editable settings section is one entry here (key, schema, defaults,
// reader), not another copy of the validate-store-publish code.
const SECTIONS: Readonly<Record<SectionName, SectionSpec>> = {
  heist: {
    key: HEIST_SETTINGS_KEY,
    schema: heistSettingsSchema,
    defaults: DEFAULT_HEIST_SETTINGS,
    read: (r) => r.heistSettings(),
  },
  vehicles: {
    key: VEHICLE_SETTINGS_KEY,
    schema: vehicleSettingsSchema,
    defaults: DEFAULT_VEHICLE_SETTINGS,
    read: (r) => r.vehicleSettings(),
  },
  atmosphere: {
    key: ATMOSPHERE_SETTINGS_KEY,
    schema: atmosphereSettingsSchema,
    defaults: DEFAULT_ATMOSPHERE_SETTINGS,
    read: (r) => r.atmosphereSettings(),
  },
  rewardIcons: {
    key: REWARD_ICONS_KEY,
    schema: rewardIconsSchema,
    defaults: DEFAULT_REWARD_ICONS,
    read: (r) => r.rewardIcons(),
  },
  city: {
    key: CITY_SETTINGS_KEY,
    schema: citySettingsSchema,
    defaults: DEFAULT_CITY_SETTINGS,
    read: (r) => r.citySettings(),
  },
};

const isPlain = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** `changes` laid over `base`, nested plain objects merged key by key. */
function mergeDeep(base: unknown, changes: unknown): unknown {
  if (!isPlain(base) || !isPlain(changes)) return changes;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(changes)) out[k] = k in base ? mergeDeep(base[k], v) : v;
  return out;
}
