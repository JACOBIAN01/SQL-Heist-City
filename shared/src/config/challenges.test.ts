import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CHALLENGE_SETTINGS,
  DEFAULT_REWARD_TIERS,
  challengeSettingsSchema,
  tierRangeSchema,
  vaultLockTier,
} from './challenges';

describe('challenge config', () => {
  it('has the documented defaults', () => {
    expect(DEFAULT_CHALLENGE_SETTINGS).toMatchObject({ lockoutSec: 20, ttlSec: 300 });
    expect(DEFAULT_REWARD_TIERS['gun:sniper']).toEqual({ min: 5, max: 5 });
  });

  it('merges partial overrides with defaults', () => {
    expect(challengeSettingsSchema.parse({ lockoutSec: 5 })).toEqual({
      ...DEFAULT_CHALLENGE_SETTINGS,
      lockoutSec: 5,
    });
  });

  it('rejects inverted tier ranges', () => {
    expect(tierRangeSchema.safeParse({ min: 4, max: 2 }).success).toBe(false);
  });

  it('computes vault lock tiers capped at 5', () => {
    expect([1, 2, 3].map((k) => vaultLockTier(1, k).min)).toEqual([1, 2, 3]);
    expect([1, 2, 3].map((k) => vaultLockTier(4, k).min)).toEqual([4, 5, 5]);
  });
});
