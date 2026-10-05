import { z } from 'zod';

/**
 * Heist rules as numbers. Defaults only: the admin settings table can
 * override any of them (docs/gameplay.md), so a teacher retunes the game
 * without a code change.
 */
export const heistSettingsSchema = z.object({
  /** Locks on every vault; lock k asks a question of tier min(5, bankTier + k - 1). */
  locksPerVault: z.number().int().min(1).max(9).default(3),
  /** Cash in a vault by bank tier (keys "1"–"5"), split evenly over its loot bags. */
  vaultLootByTier: z
    .record(z.string(), z.number().int().min(0))
    .default({ '1': 50_000, '2': 100_000, '3': 200_000, '4': 400_000, '5': 800_000 }),
  /** How close (m) a player must be to a bag to pick it up. */
  bagPickupRadius: z.number().positive().default(1.4),
  /** Hit points a heal task restores, by tier name (`heal:<tier>`); capped at max HP, so a big number means "full". */
  healByTier: z
    .record(z.string(), z.number().int().positive())
    .default({ small: 20, medium: 50, full: 1000 }),
  /** Cash the killer takes from a kill, on top of what the victim drops. Keeps the hunters hunting. */
  killBonus: z.number().int().min(0).default(2_000),
  /**
   * Bounties: a player carrying at least `bountyThreshold` is wanted. Everyone
   * sees where the wanted are on the minimap (refreshed every `bountyEverySec`),
   * and whoever kills one is paid `bountyReward` on top of the dropped cash.
   */
  bountyThreshold: z.number().int().min(0).default(100_000),
  bountyReward: z.number().int().min(0).default(10_000),
  bountyEverySec: z.number().positive().default(2),
  /** Length of a round, and how long after it starts new players may still join. */
  roundMinutes: z.number().positive().default(15),
  joinWindowMinutes: z.number().min(0).default(3),
  /** Once every vault is open and its loot gone, the round ends this many seconds later (time to bank). */
  overtimeSeconds: z.number().min(0).default(60),
  /** Pause between the end of a round and the next one starting. */
  intermissionSeconds: z.number().min(0).default(20),
  /** Seconds between scoreboard updates. */
  scoreboardEverySec: z.number().positive().default(3),
  /** Seconds a player must stay at a safehouse, unhurt, to bank what they carry. */
  bankingSeconds: z.number().positive().default(4),
  /** Top speed lost per $100k carried (0.1 = 10%), up to `carrySlowMax`. */
  carrySlowPer100k: z.number().min(0).max(1).default(0.1),
  carrySlowMax: z.number().min(0).max(0.9).default(0.3),
});

export type HeistSettings = z.infer<typeof heistSettingsSchema>;
export const DEFAULT_HEIST_SETTINGS: HeistSettings = heistSettingsSchema.parse({});

/** Top-speed multiplier for a player carrying `cash`. Server and client use the same function, so prediction agrees. */
export function carrySpeedScale(cash: number, settings: HeistSettings): number {
  const slow = Math.min(settings.carrySlowMax, (cash / 100_000) * settings.carrySlowPer100k);
  return 1 - Math.max(0, slow);
}
