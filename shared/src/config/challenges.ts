import { z } from 'zod';
import { MAX_TIER, MIN_TIER } from '../questions/template';

/**
 * Challenge rules. These are only defaults: every value can be overridden
 * from the admin (settings table), per docs/gameplay.md.
 */
export const challengeSettingsSchema = z.object({
  /** Seconds a challenge is locked after a wrong submit. */
  lockoutSec: z.number().int().min(0).max(600).default(20),
  /** Seconds before an unsolved challenge expires (no penalty). */
  ttlSec: z.number().int().min(30).max(3600).default(300),
  /** Minimum gap between Run (preview) presses. */
  runCooldownMs: z.number().int().min(0).max(60_000).default(1_500),
  /** Minimum gap between Submit presses (on top of lockout). */
  submitCooldownMs: z.number().int().min(0).max(60_000).default(2_000),
  /** Minimum gap between new challenge requests. */
  requestCooldownMs: z.number().int().min(0).max(60_000).default(3_000),
  /** Rows per table shown to the student as samples. */
  sampleRows: z.number().int().min(0).max(20).default(3),
});

export type ChallengeSettings = z.infer<typeof challengeSettingsSchema>;
export const DEFAULT_CHALLENGE_SETTINGS: ChallengeSettings = challengeSettingsSchema.parse({});

export const tierRangeSchema = z
  .object({
    min: z.number().int().min(MIN_TIER).max(MAX_TIER),
    max: z.number().int().min(MIN_TIER).max(MAX_TIER),
  })
  .refine((r) => r.min <= r.max, 'min must be ≤ max');

export type TierRange = z.infer<typeof tierRangeSchema>;

/** Default reward → question tier mapping (docs/questions.md). Editable in admin. */
export const DEFAULT_REWARD_TIERS: Readonly<Record<string, TierRange>> = {
  'heal:small': { min: 1, max: 1 },
  'heal:medium': { min: 3, max: 3 },
  'heal:full': { min: 4, max: 4 },
  'ammo:refill': { min: 1, max: 1 },
  'gun:pistol': { min: 1, max: 1 },
  'gun:smg': { min: 3, max: 3 },
  'gun:shotgun': { min: 3, max: 3 },
  'gun:rifle': { min: 4, max: 4 },
  'gun:sniper': { min: 5, max: 5 },
};

/** Vault lock k (1-based) of a bank of tier t asks a question of tier min(5, t + k − 1). */
export function vaultLockTier(bankTier: number, lock: number): TierRange {
  const tier = Math.min(MAX_TIER, Math.max(MIN_TIER, bankTier + lock - 1));
  return { min: tier, max: tier };
}
