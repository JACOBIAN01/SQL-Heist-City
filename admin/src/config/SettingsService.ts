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
  DEFAULT_NAME_RULES,
  DEFAULT_ANALYTICS_SETTINGS,
  DEFAULT_DIALECT_SETTINGS,
  DEFAULT_PRIVACY_SETTINGS,
  DEFAULT_PROGRESSION_SETTINGS,
  progressionSettingsSchema,
  privacySettingsSchema,
  dialectSettingsSchema,
  analyticsSettingsSchema,
  nameRulesSchema,
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
  settingsParsers,
  ATMOSPHERE_SETTINGS_KEY,
  CITY_SETTINGS_KEY,
  ANALYTICS_SETTINGS_KEY,
  DIALECT_SETTINGS_KEY,
  PRIVACY_SETTINGS_KEY,
  PROGRESSION_SETTINGS_KEY,
  HEIST_SETTINGS_KEY,
  NAME_RULES_KEY,
  REWARD_ICONS_KEY,
  VEHICLE_SETTINGS_KEY,
  CHALLENGE_SETTINGS_KEY,
  COMBAT_SETTINGS_KEY,
  TUTORIAL_SETTINGS_KEY,
} from '@heist/server/config/SettingsReader';
import type { SettingsStore } from '@heist/server/config/SettingsStore';
import type { ZodType } from 'zod';
import { HttpError } from '../http/errors';
import type { AdminEventBus } from '../events/AdminEvents';

/** Writes gameplay settings; reads go through the same reader the game uses. */
export class SettingsService {
  constructor(
    private readonly store: SettingsStore,
    private readonly events: AdminEventBus,
  ) {}

  private async current<T>(key: string, parse: (raw: unknown) => T): Promise<T> {
    return parse(await this.store.get(key));
  }

  private async rewardTiersOf(key: string): Promise<{ min: number; max: number }> {
    const o = (await this.store.rewardOverrides()).find((r) => r.key === key);
    return o
      ? { min: o.min, max: o.max }
      : (DEFAULT_REWARD_TIERS[key] as { min: number; max: number });
  }

  async challengeSettings(): Promise<{ current: ChallengeSettings; defaults: ChallengeSettings }> {
    return {
      current: await this.current(CHALLENGE_SETTINGS_KEY, settingsParsers.challengeFrom),
      defaults: DEFAULT_CHALLENGE_SETTINGS,
    };
  }

  /** Merges a partial change into the current values; the full result is validated. */
  async updateChallengeSettings(changes: unknown, actor: AdminUser): Promise<ChallengeSettings> {
    const before = await this.current(CHALLENGE_SETTINGS_KEY, settingsParsers.challengeFrom);
    const parsed = challengeSettingsSchema.safeParse({ ...before, ...(changes as object) });
    if (!parsed.success) {
      throw new HttpError(
        400,
        'validation_failed',
        'Some settings are invalid',
        parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      );
    }
    await this.store.put(CHALLENGE_SETTINGS_KEY, parsed.data);
    this.events.publish({
      type: 'settings_changed',
      key: CHALLENGE_SETTINGS_KEY,
      actor: { id: actor.id, email: actor.email },
      before,
      after: parsed.data,
    });
    return parsed.data;
  }

  async combatSettings(): Promise<{ current: CombatSettings; defaults: CombatSettings }> {
    return {
      current: await this.current(COMBAT_SETTINGS_KEY, settingsParsers.combatFrom),
      defaults: DEFAULT_COMBAT_SETTINGS,
    };
  }

  /**
   * Merges a partial change (top-level numbers, and per gun only the fields
   * given) into the current values; the full result is validated. Applies
   * in matches from their next round.
   */
  async updateCombatSettings(changes: unknown, actor: AdminUser): Promise<CombatSettings> {
    const before = await this.current(COMBAT_SETTINGS_KEY, settingsParsers.combatFrom);
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
    await this.store.put(COMBAT_SETTINGS_KEY, parsed.data);
    this.events.publish({
      type: 'settings_changed',
      key: COMBAT_SETTINGS_KEY,
      actor: { id: actor.id, email: actor.email },
      before,
      after: parsed.data,
    });
    return parsed.data;
  }

  async tutorialSettings(): Promise<{ current: TutorialSettings; defaults: TutorialSettings }> {
    return {
      current: await this.current(TUTORIAL_SETTINGS_KEY, settingsParsers.tutorialFrom),
      defaults: DEFAULT_TUTORIAL_SETTINGS,
    };
  }

  /**
   * Merges a partial change (the fixed questions one by one) into the current
   * values. Every fixed question must exist; new tutorials use the change.
   */
  async updateTutorialSettings(changes: unknown, actor: AdminUser): Promise<TutorialSettings> {
    const before = await this.current(TUTORIAL_SETTINGS_KEY, settingsParsers.tutorialFrom);
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
      if (!(await this.store.questionSlugExists(slug)))
        throw new HttpError(400, 'unknown_question', `No question "${slug}" (tutorial ${task})`);
    }
    await this.store.put(TUTORIAL_SETTINGS_KEY, parsed.data);
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
  async section(name: SectionName): Promise<{ current: object; defaults: object }> {
    const spec = SECTIONS[name];
    return { current: await this.current(spec.key, spec.parse), defaults: spec.defaults };
  }

  /**
   * Merges a partial change into the section (nested objects field by field,
   * so retuning one car or one bank's loot keeps the rest) and validates the
   * whole. Cars, heist rules and the sky reach running matches at their next
   * round; a new city only applies to matches created afterwards.
   */
  async updateSection(name: SectionName, changes: unknown, actor: AdminUser): Promise<object> {
    const spec = SECTIONS[name];
    if (typeof changes !== 'object' || changes === null || Array.isArray(changes))
      throw new HttpError(400, 'validation_failed', `${name} settings must be an object`);
    const before = await this.current(spec.key, spec.parse);
    const parsed = spec.schema.safeParse(mergeDeep(before, changes));
    if (!parsed.success) {
      throw new HttpError(
        400,
        'validation_failed',
        'Some settings are invalid',
        parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      );
    }
    await this.store.put(spec.key, parsed.data);
    this.events.publish({
      type: 'settings_changed',
      key: spec.key,
      actor: { id: actor.id, email: actor.email },
      before,
      after: parsed.data,
    });
    return parsed.data as object;
  }

  async rewardMap(): Promise<RewardTierEntry[]> {
    const overrides = new Set((await this.store.rewardOverrides()).map((r) => r.key));
    return Promise.all(
      Object.keys(DEFAULT_REWARD_TIERS).map(async (key) => {
        const tiers = await this.rewardTiersOf(key);
        return { key, min: tiers.min, max: tiers.max, isDefault: !overrides.has(key) };
      }),
    );
  }

  /** Saves overrides; entries equal to the default remove the override. */
  async updateRewardMap(update: RewardMapUpdate, actor: AdminUser): Promise<RewardTierEntry[]> {
    for (const r of update.rewards) {
      if (!(r.key in DEFAULT_REWARD_TIERS))
        throw new HttpError(400, 'unknown_reward', `Unknown reward "${r.key}"`);
      if (r.min > r.max)
        throw new HttpError(400, 'validation_failed', `${r.key}: min must be ≤ max`);
    }
    const before = await this.rewardMap();
    await this.store.applyRewards(
      update.rewards.map((r) => {
        const def = DEFAULT_REWARD_TIERS[r.key] as { min: number; max: number };
        const same = def.min === r.min && def.max === r.max;
        return { key: r.key, override: same ? null : { min: r.min, max: r.max } };
      }),
    );
    const after = await this.rewardMap();
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

export type SectionName =
  | 'heist'
  | 'vehicles'
  | 'atmosphere'
  | 'city'
  | 'rewardIcons'
  | 'names'
  | 'analytics'
  | 'dialects'
  | 'privacy'
  | 'progression';
export const SECTION_NAMES: readonly SectionName[] = [
  'heist',
  'vehicles',
  'atmosphere',
  'city',
  'rewardIcons',
  'names',
  'analytics',
  'dialects',
  'privacy',
  'progression',
];

interface SectionSpec {
  readonly key: string;
  readonly schema: ZodType;
  readonly defaults: object;
  readonly parse: (raw: unknown) => object;
}

// Pattern: Registry — Why: a new editable settings section is one entry here (key, schema, defaults,
// reader), not another copy of the validate-store-publish code.
const SECTIONS: Readonly<Record<SectionName, SectionSpec>> = {
  heist: {
    key: HEIST_SETTINGS_KEY,
    schema: heistSettingsSchema,
    defaults: DEFAULT_HEIST_SETTINGS,
    parse: settingsParsers.heistFrom,
  },
  vehicles: {
    key: VEHICLE_SETTINGS_KEY,
    schema: vehicleSettingsSchema,
    defaults: DEFAULT_VEHICLE_SETTINGS,
    parse: settingsParsers.vehicleFrom,
  },
  atmosphere: {
    key: ATMOSPHERE_SETTINGS_KEY,
    schema: atmosphereSettingsSchema,
    defaults: DEFAULT_ATMOSPHERE_SETTINGS,
    parse: settingsParsers.atmosphereFrom,
  },
  analytics: {
    key: ANALYTICS_SETTINGS_KEY,
    schema: analyticsSettingsSchema,
    defaults: DEFAULT_ANALYTICS_SETTINGS,
    parse: settingsParsers.analyticsFrom,
  },
  names: {
    key: NAME_RULES_KEY,
    schema: nameRulesSchema,
    defaults: DEFAULT_NAME_RULES,
    parse: settingsParsers.namesFrom,
  },
  rewardIcons: {
    key: REWARD_ICONS_KEY,
    schema: rewardIconsSchema,
    defaults: DEFAULT_REWARD_ICONS,
    parse: settingsParsers.rewardIconsFrom,
  },
  privacy: {
    key: PRIVACY_SETTINGS_KEY,
    schema: privacySettingsSchema,
    defaults: DEFAULT_PRIVACY_SETTINGS,
    parse: settingsParsers.privacyFrom,
  },
  progression: {
    key: PROGRESSION_SETTINGS_KEY,
    schema: progressionSettingsSchema,
    defaults: DEFAULT_PROGRESSION_SETTINGS,
    parse: settingsParsers.progressionFrom,
  },
  dialects: {
    key: DIALECT_SETTINGS_KEY,
    schema: dialectSettingsSchema,
    defaults: DEFAULT_DIALECT_SETTINGS,
    parse: settingsParsers.dialectsFrom,
  },
  city: {
    key: CITY_SETTINGS_KEY,
    schema: citySettingsSchema,
    defaults: DEFAULT_CITY_SETTINGS,
    parse: settingsParsers.cityFrom,
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
