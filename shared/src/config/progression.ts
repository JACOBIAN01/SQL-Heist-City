import { z } from 'zod';

/**
 * XP and ranks (Phase 26.1), editable by an admin. Learning counts for more than fighting: the
 * caps on play XP keep a player who only shoots from out-ranking one who is learning.
 */
export const rankSchema = z.object({
  name: z.string().min(1).max(30),
  /** Total XP at which the rank is reached. */
  minXp: z.number().int().min(0),
});
export type Rank = z.infer<typeof rankSchema>;

export const progressionSettingsSchema = z.object({
  /** XP for a solved question of tier 1…5. */
  tierXp: z.array(z.number().min(0)).length(5).default([20, 35, 55, 80, 120]),
  /** Multiplier when the answer was right at the first try. */
  firstTryBonus: z.number().min(1).max(3).default(1.25),
  /** Multiplier for each paid hint used (compounding), so hints cost a little XP. */
  hintFactor: z.number().min(0).max(1).default(0.9),
  /** Extra multiplier on a question of a topic the student has not yet got right in the last few. */
  newTopicBonus: z.number().min(1).max(3).default(1.5),
  /** XP per kill, per $1,000 banked, for finishing a round, and for the top three of a round. */
  play: z
    .object({
      perKill: z.number().min(0).default(4),
      perThousandBanked: z.number().min(0).default(8),
      roundFinished: z.number().min(0).default(20),
      podium: z.array(z.number().min(0)).max(3).default([40, 25, 15]),
      /** Most play XP one round can give, so fighting cannot outrun learning. */
      roundCap: z.number().min(0).default(150),
    })
    .default({
      perKill: 4,
      perThousandBanked: 8,
      roundFinished: 20,
      podium: [40, 25, 15],
      roundCap: 150,
    }),
  ranks: z
    .array(rankSchema)
    .min(1)
    .default([
      { name: 'Rookie', minXp: 0 },
      { name: 'Lookout', minXp: 100 },
      { name: 'Runner', minXp: 300 },
      { name: 'Cracker', minXp: 700 },
      { name: 'Safecracker', minXp: 1500 },
      { name: 'Fixer', minXp: 3000 },
      { name: 'Mastermind', minXp: 6000 },
    ]),
});
export type ProgressionSettings = z.infer<typeof progressionSettingsSchema>;
export const DEFAULT_PROGRESSION_SETTINGS: ProgressionSettings = progressionSettingsSchema.parse(
  {},
);
