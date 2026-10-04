import type { ChallengeSettings, HeistSettings, TierRange } from '@heist/shared';
import type { SettingsReader } from './SettingsReader';

// Pattern: Decorator — Why: same caching-with-invalidate idea as
// CachedQuestionReader, applied to settings read on every challenge action.
export class CachedSettingsReader implements SettingsReader {
  private challenges: ChallengeSettings | undefined;
  private heist: HeistSettings | undefined;
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

  rewardTiers(rewardKey: string): TierRange | undefined {
    if (!this.tiers.has(rewardKey)) this.tiers.set(rewardKey, this.inner.rewardTiers(rewardKey));
    return this.tiers.get(rewardKey);
  }

  invalidate(): void {
    this.challenges = undefined;
    this.heist = undefined;
    this.tiers = new Map();
  }
}
