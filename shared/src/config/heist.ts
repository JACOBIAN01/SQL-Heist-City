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
  /**
   * Loose cash in bank offices, per pile, by bank tier (keys "1"–"5"). Laid out
   * at the start of every round; small next to a vault, but no lock guards it.
   */
  looseCashByTier: z
    .record(z.string(), z.number().int().min(0))
    .default({ '1': 1_000, '2': 1_500, '3': 2_000, '4': 3_000, '5': 4_000 }),
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
  /** Offer signed-in players a planning brief (an open Build task) once a round ends. */
  planningBriefs: z.boolean().default(true),
  /** Seconds between scoreboard updates. */
  scoreboardEverySec: z.number().positive().default(3),
  /** Seconds a player must stay at a safehouse, unhurt, to bank what they carry. */
  bankingSeconds: z.number().positive().default(4),
  /**
   * Streak bonus (Phase 26.4): answers that are right at the first go, one after another, earn
   * extra carried cash from the `minStreak`-th on: `cashPerStep` for it, more for each further one,
   * up to `cap`. A wrong submit or a death ends the streak. 0 for `cashPerStep` switches it off.
   */
  streak: z
    .object({
      minStreak: z.number().int().min(2).default(3),
      cashPerStep: z.number().int().min(0).default(500),
      cap: z.number().int().min(0).default(3_000),
    })
    .default({ minStreak: 3, cashPerStep: 500, cap: 3_000 }),
  /**
   * Bank guards (Phase 29.3): armed staff who walk a short beat around the vault console, hold the
   * room when a lock is cracked, and shoot at anyone they can see. They are small in number and
   * beatable; a guard brought down pays a little, and is back next round.
   */
  guards: z
    .object({
      /** Guards in a bank, by its tier ("1"–"5"); 0 or missing means none. */
      perBankTier: z
        .record(z.string(), z.number().int().min(0).max(8))
        .default({ '1': 1, '2': 1, '3': 2, '4': 2, '5': 3 }),
      /** The gun they carry (a key of the combat settings' weapons). */
      weapon: z.string().default('pistol'),
      /** Walking pace as a share of a player's. */
      speed: z.number().min(0.1).max(1).default(0.55),
      /** They see a player this far (m) if nothing is in the way. */
      sightRange: z.number().positive().max(80).default(22),
      /** Their aim wanders by up to this many degrees, so they miss. */
      aimErrorDegrees: z.number().min(0).max(30).default(5),
      /** The beat is a ring this many metres round the console. */
      beatRadius: z.number().positive().max(15).default(4),
      /** After an alarm they hold the console for this many seconds. */
      alertSeconds: z.number().min(0).max(300).default(30),
      /** Damage they take is multiplied by this (1 is the same as a player). */
      damageTakenScale: z.number().min(0.1).max(3).default(1),
      /** Cash a player is paid for bringing one down. */
      killBonus: z.number().int().min(0).default(500),
      /** Guards further than this (m) from every player stand still. */
      activeRange: z.number().positive().max(300).default(90),
    })
    .default({
      perBankTier: { '1': 1, '2': 1, '3': 2, '4': 2, '5': 3 },
      weapon: 'pistol',
      speed: 0.55,
      sightRange: 22,
      aimErrorDegrees: 5,
      beatRadius: 4,
      alertSeconds: 30,
      damageTakenScale: 1,
      killBonus: 500,
      activeRange: 90,
    }),
  /**
   * Roles in a squad (Phase 27.3): each member may take one, each role once per squad. The perks
   * are small on purpose; they reward working as a team, not winning alone.
   */
  roles: z
    .object({
      /** Hacker: hints cost this share of the normal price. */
      hackerHintCostScale: z.number().min(0).max(1).default(0.5),
      /** Driver: damage taken while in a car is multiplied by this. */
      driverCarDamageScale: z.number().min(0.1).max(1).default(0.6),
      /** Enforcer: damage taken on foot is multiplied by this. */
      enforcerDamageScale: z.number().min(0.1).max(1).default(0.85),
      /** Lookout: rivals within this many metres show on their minimap (0 switches it off)… */
      lookoutRadarMetres: z.number().min(0).max(300).default(60),
    })
    .default({
      hackerHintCostScale: 0.5,
      driverCarDamageScale: 0.6,
      enforcerDamageScale: 0.85,
      lookoutRadarMetres: 60,
    }),
  /** Squad names (Phase 27), by squad number: the first for squad 1, and so on. */
  squadNames: z
    .array(z.string().min(1).max(20))
    .min(2)
    .default(['Red', 'Blue', 'Green', 'Gold', 'Violet', 'Teal', 'Orange', 'Pink', 'Grey', 'Cyan']),
  /** Top speed lost per $100k carried (0.1 = 10%), up to `carrySlowMax`. */
  carrySlowPer100k: z.number().min(0).max(1).default(0.1),
  carrySlowMax: z.number().min(0).max(0.9).default(0.3),
});

export type HeistSettings = z.infer<typeof heistSettingsSchema>;
export const DEFAULT_HEIST_SETTINGS: HeistSettings = heistSettingsSchema.parse({});

/** Cash for the `streak`-th clean answer in a row (0 below the minimum, or when switched off). */
export function streakBonus(streak: number, settings: HeistSettings): number {
  const { minStreak, cashPerStep, cap } = settings.streak;
  if (cashPerStep <= 0 || streak < minStreak) return 0;
  return Math.min(cap, cashPerStep * (streak - minStreak + 1));
}

/** Top-speed multiplier for a player carrying `cash`. Server and client use the same function, so prediction agrees. */
export function carrySpeedScale(cash: number, settings: HeistSettings): number {
  const slow = Math.min(settings.carrySlowMax, (cash / 100_000) * settings.carrySlowPer100k);
  return 1 - Math.max(0, slow);
}
