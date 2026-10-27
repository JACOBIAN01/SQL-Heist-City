import { z } from 'zod';
import { MAX_TIER, MIN_TIER } from '../questions/template';
import { TASK_KINDS, type TaskKind } from '../questions/taskTypes';

/** Every kind but the open brief: what an in-round task may ask by default. */
const IN_ROUND_KINDS: TaskKind[] = TASK_KINDS.filter((k) => k !== 'brief');

/**
 * Challenge rules. These are only defaults: every value can be overridden
 * from the admin (settings table), per docs/gameplay.md.
 */
export const challengeSettingsSchema = z.object({
  /** Seconds a challenge is locked after a wrong submit. */
  lockoutSec: z.number().int().min(0).max(600).default(10),
  /** Seconds before an unsolved challenge expires (no penalty). */
  ttlSec: z.number().int().min(30).max(3600).default(300),
  /** Minimum gap between Run (preview) presses. */
  runCooldownMs: z.number().int().min(0).max(60_000).default(1_500),
  /** Minimum gap between Submit presses (on top of lockout). */
  submitCooldownMs: z.number().int().min(0).max(60_000).default(2_000),
  /** Minimum gap between new challenge requests. */
  requestCooldownMs: z.number().int().min(0).max(60_000).default(3_000),
  /**
   * How a hint's `cost` is charged: a fraction of the player's carried cash
   * (0.05 = 5%) or an absolute amount.
   */
  hintCostMode: z.enum(['fraction', 'absolute']).default('fraction'),
  /**
   * Free steps at the start of the hint ladder, before the question's paid hints: 1 = a one-line
   * nudge, 2 = the nudge, then the topic's concept card. 0 = no free steps. Needs a concept card for the topic.
   */
  freeHintSteps: z.number().int().min(0).max(2).default(2),
  /** Rows per table shown to the student as samples. */
  sampleRows: z.number().int().min(0).max(20).default(3),
  /**
   * The worked example ("expected output") is computed on separate small data:
   * this many rows per table at first, more on each of `exampleTries` tries,
   * then full-size data, until the answer has rows.
   */
  exampleRows: z.number().int().min(1).max(50).default(6),
  exampleTries: z.number().int().min(0).max(10).default(3),
  /** Rows of each example table and of its output shown to the student. */
  exampleShownRows: z.number().int().min(1).max(50).default(10),
  /**
   * Which kinds of task each reward family may ask ("heal", "gun", "vault", "brief"…); `*`
   * covers families not listed. Open briefs are only for planning between rounds by default.
   */
  taskKinds: z
    .record(z.string(), z.array(z.enum(TASK_KINDS)).min(1))
    .default({ '*': IN_ROUND_KINDS, brief: ['brief'] }),
});

/** The task kinds a reward may ask, from the settings. */
export function kindsFor(settings: ChallengeSettings, rewardKey: string): ReadonlySet<TaskKind> {
  const family = rewardKey.split(':')[0] ?? rewardKey;
  return new Set(settings.taskKinds[family] ?? settings.taskKinds['*'] ?? IN_ROUND_KINDS);
}

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
  /** A SQL Quick Draw duel's question (Phase 28.3): quick ones. */
  'duel:draw': { min: 1, max: 2 },
  /** Planning the next heist between rounds: an open brief (Phase 17.10). */
  /** A delivery's receipt and a street race's stewards' check (Phase 30.6). */
  'job:delivery': { min: 1, max: 3 },
  'job:race': { min: 2, max: 3 },
  'brief:plan': { min: 1, max: 5 },
};

/** Vault lock k (1-based) of a bank of tier t asks a question of tier min(5, t + k − 1). */
export function vaultLockTier(bankTier: number, lock: number): TierRange {
  const tier = Math.min(MAX_TIER, Math.max(MIN_TIER, bankTier + lock - 1));
  return { min: tier, max: tier };
}
