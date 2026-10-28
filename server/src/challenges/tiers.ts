import { intelTier, vaultLockTier, type TierRange } from '@heist/shared';
import type { SettingsReader } from '../config/SettingsReader';

/** `vault:bank-<n>:lock-<k>` — bank n has tier n (docs/gameplay.md). */
const VAULT_KEY = /^vault:bank-([1-5]):lock-([1-9])$/;

/**
 * Which question tiers a reward asks for. Heals, guns and ammo come from the
 * reward map (admin-editable); vault locks follow their bank's tier.
 */
/** `intel:bank-<n>` — a setup job for a heist on bank n (Phase 31.1). */
const INTEL_KEY = /^intel:bank-([1-5])$/;
/** `inside:bank-<n>` — the inside man's broken query at bank n (Phase 34.3). */
const INSIDE_KEY = /^inside:bank-([1-5])$/;
/** `practice:<tier>` — the solo drill: any tier 1–5, chosen by the student. */
const PRACTICE_KEY = /^practice:([1-5])$/;
/** `assess:<n>` — question n of a class assessment; the question is fixed, so any tier. */
const ASSESS_KEY = /^assess:\d+$/;

export function tiersForReward(rewardKey: string, settings: SettingsReader): TierRange | undefined {
  const vault = VAULT_KEY.exec(rewardKey);
  const practice = PRACTICE_KEY.exec(rewardKey);
  if (practice) return { min: Number(practice[1]), max: Number(practice[1]) };
  if (ASSESS_KEY.test(rewardKey)) return { min: 1, max: 5 };
  const inside = INSIDE_KEY.exec(rewardKey);
  if (inside) return intelTier(Number(inside[1]));
  const intel = INTEL_KEY.exec(rewardKey);
  if (intel) return intelTier(Number(intel[1]));
  if (vault) return vaultLockTier(Number(vault[1]), Number(vault[2]));
  return settings.rewardTiers(rewardKey);
}
