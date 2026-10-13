import { vaultLockTier, type TierRange } from '@heist/shared';
import type { SettingsReader } from '../config/SettingsReader';

/** `vault:bank-<n>:lock-<k>` — bank n has tier n (docs/gameplay.md). */
const VAULT_KEY = /^vault:bank-([1-5]):lock-([1-9])$/;

/**
 * Which question tiers a reward asks for. Heals, guns and ammo come from the
 * reward map (admin-editable); vault locks follow their bank's tier.
 */
/** `practice:<tier>` — the solo drill: any tier 1–5, chosen by the student. */
const PRACTICE_KEY = /^practice:([1-5])$/;

export function tiersForReward(rewardKey: string, settings: SettingsReader): TierRange | undefined {
  const vault = VAULT_KEY.exec(rewardKey);
  const practice = PRACTICE_KEY.exec(rewardKey);
  if (practice) return { min: Number(practice[1]), max: Number(practice[1]) };
  if (vault) return vaultLockTier(Number(vault[1]), Number(vault[2]));
  return settings.rewardTiers(rewardKey);
}
