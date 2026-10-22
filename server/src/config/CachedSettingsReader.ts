import type {
  DialectSettings,
  AtmosphereSettings,
  ChallengeSettings,
  AnalyticsSettings,
  CitySettings,
  RewardIcons,
  VehicleSettings,
  CombatSettings,
  HeistSettings,
  TierRange,
  TutorialSettings,
  ProgressionSettings,
  ModesSettings,
} from '@heist/shared';
import type { SettingsReader } from './SettingsReader';

// Pattern: Decorator — Why: same caching-with-invalidate idea as
// CachedQuestionReader, applied to settings read on every challenge action.
export class CachedSettingsReader implements SettingsReader {
  private challenges: ChallengeSettings | undefined;
  private heist: HeistSettings | undefined;
  private combat: CombatSettings | undefined;
  private tutorial: TutorialSettings | undefined;
  private vehicles: VehicleSettings | undefined;
  private atmosphere: AtmosphereSettings | undefined;
  private city: CitySettings | undefined;
  private icons: RewardIcons | undefined;
  private analytics: AnalyticsSettings | undefined;
  private progression: ProgressionSettings | undefined;
  private modes: ModesSettings | undefined;
  private dialects: DialectSettings | undefined;
  private tiers = new Map<string, TierRange | undefined>();

  constructor(private readonly inner: SettingsReader) {}

  challengeSettings(): ChallengeSettings {
    this.challenges ??= this.inner.challengeSettings();
    return this.challenges;
  }

  heistSettings(): HeistSettings {
    this.heist ??= this.inner.heistSettings();
    return this.heist;
  }

  combatSettings(): CombatSettings {
    this.combat ??= this.inner.combatSettings();
    return this.combat;
  }

  tutorialSettings(): TutorialSettings {
    this.tutorial ??= this.inner.tutorialSettings();
    return this.tutorial;
  }

  vehicleSettings(): VehicleSettings {
    this.vehicles ??= this.inner.vehicleSettings();
    return this.vehicles;
  }

  atmosphereSettings(): AtmosphereSettings {
    this.atmosphere ??= this.inner.atmosphereSettings();
    return this.atmosphere;
  }

  analyticsSettings(): AnalyticsSettings {
    this.analytics ??= this.inner.analyticsSettings();
    return this.analytics;
  }

  modesSettings(): ModesSettings {
    this.modes ??= this.inner.modesSettings();
    return this.modes;
  }

  progressionSettings(): ProgressionSettings {
    this.progression ??= this.inner.progressionSettings();
    return this.progression;
  }

  dialectSettings(): DialectSettings {
    this.dialects ??= this.inner.dialectSettings();
    return this.dialects;
  }

  rewardIcons(): RewardIcons {
    this.icons ??= this.inner.rewardIcons();
    return this.icons;
  }

  citySettings(): CitySettings {
    this.city ??= this.inner.citySettings();
    return this.city;
  }

  rewardTiers(rewardKey: string): TierRange | undefined {
    if (!this.tiers.has(rewardKey)) this.tiers.set(rewardKey, this.inner.rewardTiers(rewardKey));
    return this.tiers.get(rewardKey);
  }

  invalidate(): void {
    this.challenges = undefined;
    this.heist = undefined;
    this.combat = undefined;
    this.tutorial = undefined;
    this.vehicles = undefined;
    this.atmosphere = undefined;
    this.city = undefined;
    this.icons = undefined;
    this.analytics = undefined;
    this.progression = undefined;
    this.modes = undefined;
    this.dialects = undefined;
    this.tiers = new Map();
  }
}
