import { vaultLockTier, type TierRange } from '@heist/shared';
import type { SettingsReader } from '../config/SettingsReader';

/** `vault:bank-<n>:lock-<k>` — bank n has tier n (docs/gameplay.md). */
const VAULT_KEY = /^vault:bank-([1-5]):lock-([1-9])$/;

/**
 * Which question tiers a reward asks for. Heals, guns and ammo come from the
 * reward map (admin-editable); vault locks follow their bank's tier.
 */
export function tiersForReward(rewardKey: string, settings: SettingsReader): TierRange | undefined {
  const vault = VAULT_KEY.exec(rewardKey);
  if (vault) return vaultLockTier(Number(vault[1]), Number(vault[2]));
  return settings.rewardTiers(rewardKey);
}
