import type {
  AtmosphereSettings,
  ChallengeSettings,
  CitySettings,
  VehicleSettings,
  CombatSettings,
  HeistSettings,
  TierRange,
  TutorialSettings,
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
    this.tiers = new Map();
  }
}
