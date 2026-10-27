import { z } from 'zod';

/** The kinds of contract on a district's board (Phases 30.6 and 31.2). */
export const JOB_KINDS = ['delivery', 'race', 'intel', 'sabotage', 'data_theft', 'escort'] as const;
export type JobKind = (typeof JOB_KINDS)[number];

const DEFAULT_BOARDS: Record<string, JobKind[]> = {
  downtown: ['delivery', 'data_theft', 'sabotage'],
  'old-town': ['race', 'intel', 'escort'],
  docks: ['delivery', 'escort', 'sabotage'],
  market: ['delivery', 'intel', 'data_theft'],
  heights: ['race', 'intel', 'escort'],
};

/** Every job number at its default (a function, as the schema is built before it can parse itself). */
function jobsDefaults() {
  return {
    enabled: true,
    boards: DEFAULT_BOARDS,
    delivery: { seconds: 150, reward: 3_000, minDistance: 120, radius: 4 },
    race: { seconds: 100, checkpoints: 4, reward: 4_500, radius: 7 },
    intel: { seconds: 180, reward: 3_500, banks: 2, radius: 4 },
    sabotage: { seconds: 150, reward: 4_000, dwellSeconds: 5, blindSeconds: 60, radius: 3 },
    dataTheft: { seconds: 150, reward: 6_000, dwellSeconds: 8, radius: 3 },
    escort: { seconds: 170, reward: 5_000, minDistance: 120, radius: 5, together: 14, speed: 0.7 },
  };
}

/** One safehouse upgrade (Phase 30.4): the banked-cash price of each level, and what a level is worth. */
const upgradeSpec = (prices: number[], perLevel: number) =>
  z
    .object({
      prices: z.array(z.number().int().min(0)).min(1).max(5).default(prices),
      perLevel: z.number().min(0).default(perLevel),
    })
    .default({ prices, perLevel });

/** Collectible data chips (Phase 30.3). */
const collectiblesSchema = z.object({
  enabled: z.boolean().default(true),
  count: z.number().int().min(0).max(60).default(24),
  /** Cash added to the carried purse for each chip. */
  cash: z.number().int().min(0).default(250),
  pickupRadius: z.number().positive().max(10).default(1.8),
  revealRange: z.number().positive().max(200).default(35),
  trivia: z
    .array(z.object({ title: z.string().min(1).max(40), fact: z.string().min(1).max(200) }))
    .min(1)
    .default([
      {
        title: 'SELECT *',
        fact: 'SELECT * returns every column. Handy for a look, but name the columns you need in real queries.',
      },
      {
        title: 'WHERE before GROUP BY',
        fact: 'WHERE filters rows before they are grouped; HAVING filters the groups afterwards.',
      },
      {
        title: 'NULL is not equal',
        fact: 'NULL is never equal to anything, not even NULL. Use IS NULL, not = NULL.',
      },
      {
        title: 'INNER JOIN',
        fact: 'An INNER JOIN keeps only rows that have a match on both sides.',
      },
      {
        title: 'LEFT JOIN',
        fact: 'A LEFT JOIN keeps every row from the left table, with NULLs where nothing matched.',
      },
      {
        title: 'COUNT(*) vs COUNT(col)',
        fact: 'COUNT(*) counts rows; COUNT(column) skips the rows where that column is NULL.',
      },
      {
        title: 'DISTINCT',
        fact: 'DISTINCT removes duplicate rows from the result, comparing whole rows.',
      },
      {
        title: 'ORDER BY',
        fact: 'Without ORDER BY a table has no promised order, however it looked last time.',
      },
      {
        title: 'LIMIT',
        fact: 'LIMIT stops after N rows; pair it with ORDER BY or you get an arbitrary N.',
      },
      {
        title: 'LIKE wildcards',
        fact: 'In LIKE, % matches any run of characters and _ matches exactly one.',
      },
      { title: 'IN', fact: 'x IN (1, 2, 3) is shorthand for x = 1 OR x = 2 OR x = 3.' },
      {
        title: 'BETWEEN',
        fact: 'BETWEEN is inclusive at both ends: 1 AND 3 includes 1 and 3.',
      },
      {
        title: 'Aliases',
        fact: 'AS gives a column or table another name for the rest of the query.',
      },
      {
        title: 'Window functions',
        fact: 'A window function like ROW_NUMBER() OVER (...) adds a value per row without collapsing rows.',
      },
      {
        title: 'CASE',
        fact: "CASE WHEN ... THEN ... ELSE ... END is SQL's if-else inside a query.",
      },
      {
        title: 'COALESCE',
        fact: 'COALESCE(a, b, c) returns the first value that is not NULL.',
      },
      {
        title: 'UNION',
        fact: 'UNION removes duplicate rows; UNION ALL keeps them and is faster.',
      },
      {
        title: 'Primary key',
        fact: 'A primary key uniquely identifies each row and can never be NULL.',
      },
      {
        title: 'Foreign key',
        fact: "A foreign key points at another table's key, so a row cannot reference one that does not exist.",
      },
      {
        title: 'Subquery',
        fact: 'A subquery is a SELECT inside another query, in WHERE, FROM or SELECT.',
      },
      {
        title: 'Index',
        fact: 'An index lets the database find rows without reading the whole table, at a small cost on writes.',
      },
      {
        title: 'Transactions',
        fact: 'A transaction groups changes so they all happen or none do.',
      },
      {
        title: 'HAVING',
        fact: 'HAVING is how you filter on an aggregate such as COUNT(*) > 3.',
      },
      {
        title: 'SQL name',
        fact: 'SQL began in the 1970s at IBM as SEQUEL; the name was shortened for trademark reasons.',
      },
    ]),
});

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
   * The police (Phase 29.4): crimes earn a wanted level (stars). Officers come for anyone who has
   * stars, on foot, from beyond sight; at the higher levels some set up a roadblock ahead. Break
   * away for long enough and a star goes; at no stars the officers leave. Dying clears it.
   */
  police: z
    .object({
      enabled: z.boolean().default(true),
      /** The gun an officer carries. */
      weapon: z.string().default('pistol'),
      /** Officers sent after you for each star. */
      perStar: z.number().int().min(0).max(5).default(1),
      maxStars: z.number().int().min(1).max(5).default(5),
      /** Stars each crime adds. */
      crimeStars: z
        .object({
          /** Cracking a vault lock (the alarm). */
          lock: z.number().int().min(0).max(5).default(1),
          /** Bringing down a bank guard. */
          guard: z.number().int().min(0).max(5).default(1),
          /** Killing another player. */
          kill: z.number().int().min(0).max(5).default(1),
          /** Killing an officer. */
          officer: z.number().int().min(0).max(5).default(1),
        })
        .default({ lock: 1, guard: 1, kill: 1, officer: 1 }),
      /** Walking pace as a share of a player's (they can catch a walker, not a sprinter). */
      speed: z.number().min(0.1).max(1).default(0.85),
      sightRange: z.number().positive().max(100).default(30),
      aimErrorDegrees: z.number().min(0).max(30).default(7),
      /** Officers appear this far (m) from you, out of sight where they can. */
      spawnMin: z.number().positive().max(300).default(45),
      spawnMax: z.number().positive().max(400).default(85),
      /** Out of every officer's sight for this long (s) and you lose a star. */
      escapeSeconds: z.number().positive().max(300).default(25),
      /** From this many stars, two officers hold a roadblock ahead of you. */
      roadblockFromStars: z.number().int().min(1).max(6).default(4),
      /** With this much intel on the bank you robbed, you are told where the roadblocks are (Phase 31.3). */
      intelRevealLevel: z.number().int().min(1).max(3).default(1),
      /** With this much, a roadblock is held by one officer instead of two. */
      intelThinLevel: z.number().int().min(1).max(3).default(3),
      /** Officers who are further than this (m) from you are not simulated (they stand still). */
      activeRange: z.number().positive().max(500).default(220),
    })
    .default({
      enabled: true,
      weapon: 'pistol',
      perStar: 1,
      maxStars: 5,
      crimeStars: { lock: 1, guard: 1, kill: 1, officer: 1 },
      speed: 0.85,
      sightRange: 30,
      aimErrorDegrees: 7,
      spawnMin: 45,
      spawnMax: 85,
      escapeSeconds: 25,
      roadblockFromStars: 4,
      intelRevealLevel: 1,
      intelThinLevel: 3,
      activeRange: 220,
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
  /**
   * Hidden caches (Phase 30.2): cash stashed on open ground, somewhere new each round. A cache shows
   * only when you are within `revealRange`; walking over it pays `amount` into your carried cash.
   * (Intel from SQL jobs will reveal them from afar, Phase 33.)
   */
  caches: z
    .object({
      enabled: z.boolean().default(true),
      count: z.number().int().min(0).max(40).default(8),
      amount: z.number().int().min(0).default(1_500),
      pickupRadius: z.number().positive().max(10).default(1.8),
      revealRange: z.number().positive().max(200).default(30),
    })
    .default({ enabled: true, count: 8, amount: 1_500, pickupRadius: 1.8, revealRange: 30 }),
  /**
   * Collectible data chips (Phase 30.3): the same spots every round, so a student can find them all
   * over several matches. Each shows a piece of SQL trivia once found, and what they have found is
   * kept with their account. Trivia is data: add, reword or remove entries here.
   */
  collectibles: collectiblesSchema.default(() => collectiblesSchema.parse({})),
  /**
   * A heist in three acts (Phase 31.1): **setup** (intel jobs at the terminal outside a bank, each a
   * SQL question), **the heist** (the vault's locks) and **the getaway** (carry the take to a
   * safehouse). Each intel point does something: 1 shows the bank's guards on your map, 2 makes the
   * alarm fade `alertScale` as fast, 3 adds `lootBonus` to the vault's cash.
   */
  acts: z
    .object({
      enabled: z.boolean().default(true),
      intelMax: z.number().int().min(1).max(3).default(3),
      /** Guards stay on alert this share as long, with intel level 2. */
      alertScale: z.number().min(0.1).max(1).default(0.5),
      /** Extra share of the vault's cash with intel level 3. */
      lootBonus: z.number().min(0).max(1).default(0.1),
      /** Guards are shown on the map from this far (m). */
      mapRange: z.number().positive().default(90),
    })
    .default({ enabled: true, intelMax: 3, alertScale: 0.5, lootBonus: 0.1, mapRange: 90 }),
  /**
   * The payout screen (Phase 31.4) and what a finished heist teaches: mastery XP is
   * `masteryXpPerTier` for each tier of the bank, plus `ghostXp` for a ghost job.
   */
  payout: z
    .object({
      enabled: z.boolean().default(true),
      masteryXpPerTier: z.number().int().min(0).default(40),
      ghostXp: z.number().int().min(0).default(25),
    })
    .default({ enabled: true, masteryXpPerTier: 40, ghostXp: 25 }),
  /**
   * How to break in (Phase 30.7). **Stealth** (a toggle): you move slower, and a lock cracked while
   * no guard or officer can see you is *quiet*: no alarm, no police, nothing on the map. A vault
   * whose every lock was quiet is a *ghost* job and pays `ghostBonus` more. **Loud** (the default):
   * the alarm rings and the guards and police come, but each lock pays `loudBonus` at once.
   */
  approach: z
    .object({
      enabled: z.boolean().default(true),
      stealthSpeed: z.number().min(0.2).max(1).default(0.75),
      ghostBonus: z.number().min(0).max(2).default(0.3),
      loudBonus: z.number().int().min(0).default(500),
    })
    .default({ enabled: true, stealthSpeed: 0.75, ghostBonus: 0.3, loudBonus: 500 }),
  /**
   * Side jobs (Phase 30.6): each district's job board offers one kind of job, for cash. A delivery
   * is a run to another district's board; a street race is a lap through checkpoints in a car.
   * Both end at a SQL question: the delivery receipt or the race stewards' check. Wrong answers can
   * be retried until time runs out.
   */
  jobs: z
    .object({
      enabled: z.boolean().default(true),
      /** The contracts each district's board offers (the player picks one). */
      boards: z.record(z.string(), z.array(z.enum(JOB_KINDS)).min(1)).default(DEFAULT_BOARDS),
      delivery: z
        .object({
          seconds: z.number().positive().default(150),
          reward: z.number().int().min(0).default(3_000),
          /** The drop is at least this far (m) from the board. */
          minDistance: z.number().positive().default(120),
          radius: z.number().positive().default(4),
        })
        .default({ seconds: 150, reward: 3_000, minDistance: 120, radius: 4 }),
      race: z
        .object({
          seconds: z.number().positive().default(100),
          checkpoints: z.number().int().min(2).max(8).default(4),
          reward: z.number().int().min(0).default(4_500),
          radius: z.number().positive().default(7),
        })
        .default({ seconds: 100, checkpoints: 4, reward: 4_500, radius: 7 }),
      /** Recon: walk to the intel terminals of other banks; each visit is an intel point on that bank. */
      intel: z
        .object({
          seconds: z.number().positive().default(180),
          reward: z.number().int().min(0).default(3_500),
          banks: z.number().int().min(1).max(4).default(2),
          radius: z.number().positive().default(4),
        })
        .default({ seconds: 180, reward: 3_500, banks: 2, radius: 4 }),
      /** Sabotage: stand at a bank's vault console while you cut its guards' cameras (they go blind for a while). */
      sabotage: z
        .object({
          seconds: z.number().positive().default(150),
          reward: z.number().int().min(0).default(4_000),
          dwellSeconds: z.number().positive().default(5),
          blindSeconds: z.number().positive().default(60),
          radius: z.number().positive().default(3),
        })
        .default({ seconds: 150, reward: 4_000, dwellSeconds: 5, blindSeconds: 60, radius: 3 }),
      /** Data theft: copy a bank's records at its console. Pays well, and the police are told. */
      dataTheft: z
        .object({
          seconds: z.number().positive().default(150),
          reward: z.number().int().min(0).default(6_000),
          dwellSeconds: z.number().positive().default(8),
          radius: z.number().positive().default(3),
        })
        .default({ seconds: 150, reward: 6_000, dwellSeconds: 8, radius: 3 }),
      /** Escort: a person follows you to another district. Lose them and the contract fails. */
      escort: z
        .object({
          seconds: z.number().positive().default(170),
          reward: z.number().int().min(0).default(5_000),
          minDistance: z.number().positive().default(120),
          radius: z.number().positive().default(5),
          /** The escort must be this close (m) to you at the drop. */
          together: z.number().positive().default(14),
          speed: z.number().min(0.2).max(1).default(0.7),
        })
        .default({
          seconds: 170,
          reward: 5_000,
          minDistance: 120,
          radius: 5,
          together: 14,
          speed: 0.7,
        }),
    })
    .default(() => jobsDefaults()),
  /**
   * Safehouse upgrades (Phase 30.4), bought at the shop counter with *banked* cash (so each costs
   * some of the round's score) and kept with the student's account. `perLevel` is what each level
   * adds: banking time cut (share), armour you spawn with, share of carried cash kept on death,
   * and metres added to how far away caches and chips show.
   */
  upgrades: z
    .object({
      enabled: z.boolean().default(true),
      banking: upgradeSpec([5_000, 15_000, 40_000], 0.15),
      armour: upgradeSpec([8_000, 20_000, 50_000], 20),
      stash: upgradeSpec([10_000, 30_000], 0.15),
      intel: upgradeSpec([6_000, 18_000, 45_000], 12),
    })
    .default(() => ({
      enabled: true,
      banking: { prices: [5_000, 15_000, 40_000], perLevel: 0.15 },
      armour: { prices: [8_000, 20_000, 50_000], perLevel: 20 },
      stash: { prices: [10_000, 30_000], perLevel: 0.15 },
      intel: { prices: [6_000, 18_000, 45_000], perLevel: 12 },
    })),
  /**
   * Street shops (Phase 29.6), a counter beside every safehouse. They sell for cash you are
   * carrying (so spending is a risk-free way to lose it from your score): body armour, which
   * soaks damage before health, and a full reload. Prices and amounts are all here.
   */
  shop: z
    .object({
      enabled: z.boolean().default(true),
      armourPrice: z.number().int().min(0).default(2_000),
      /** Armour points one purchase adds. */
      armourPoints: z.number().int().positive().default(50),
      /** The most armour a player can wear. */
      armourMax: z.number().int().positive().default(100),
      ammoPrice: z.number().int().min(0).default(500),
    })
    .default({
      enabled: true,
      armourPrice: 2_000,
      armourPoints: 50,
      armourMax: 100,
      ammoPrice: 500,
    }),
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
