import { z } from 'zod';

/**
 * The RCSBE lens (docs/RCBSE.md): what a question measures. Exactly one per
 * question. Recall, Comprehend, Solve, Build, Evaluate.
 */
export const RCSBE_DIMENSIONS = ['R', 'C', 'S', 'B', 'E'] as const;
export type RcsbeDimension = (typeof RCSBE_DIMENSIONS)[number];

export const RCSBE_NAMES: Readonly<Record<RcsbeDimension, string>> = {
  R: 'Recall',
  C: 'Comprehend',
  S: 'Solve',
  B: 'Build',
  E: 'Evaluate',
};

/** Bloom's taxonomy, lowest to highest. Kept for curriculum alignment. */
export const BLOOM_LEVELS = [
  'remember',
  'understand',
  'apply',
  'analyze',
  'evaluate',
  'create',
] as const;
export type BloomLevel = (typeof BLOOM_LEVELS)[number];

export const BLOOM_NAMES: Readonly<Record<BloomLevel, string>> = {
  remember: 'Remember',
  understand: 'Understand',
  apply: 'Apply',
  analyze: 'Analyze',
  evaluate: 'Evaluate',
  create: 'Create',
};

/** The two tags every question carries, plus its weight in marks. */
export const rcsbeSchema = z.enum(RCSBE_DIMENSIONS);
export const bloomSchema = z.enum(BLOOM_LEVELS);
export const marksSchema = z.number().int().min(1).max(20);

/**
 * How learning is measured. Defaults only: an admin edits these (docs/RCBSE.md §6, §7).
 */
export const analyticsSettingsSchema = z.object({
  /** Marks a question is worth when it sets none of its own, by tier (keys "1"–"5"). */
  marksByTier: z
    .record(z.string(), z.number().int().min(1).max(20))
    .default({ '1': 1, '2': 2, '3': 3, '4': 4, '5': 5 }),
  /** Share of a question's marks each paid hint takes off a correct answer. */
  hintPenalty: z.number().min(0).max(1).default(0.25),
  /** A correct answer never earns less than this share of its marks, however many hints were used. */
  minEarnedShare: z.number().min(0).max(1).default(0.25),
  /** Opened and left within this many seconds, with no Run or Submit: not counted. */
  abandonSeconds: z.number().min(0).default(20),
  /** A dimension needs this many items and this many marks available before it is scored. */
  minItems: z.number().int().min(1).default(3),
  minMarks: z.number().min(0).default(5),
  /** Raw attempt events are kept this many days (0 = forever). Totals and finished items are kept longer. */
  rawEventDays: z.number().int().min(0).default(180),
  /** Finished items are kept this many days (0 = forever); the profile totals they built are kept regardless. */
  itemDays: z.number().int().min(0).default(730),
  /** Target share of marks per dimension for a class (sums to 100). */
  targetProfile: z
    .object({
      R: z.number().min(0).max(100),
      C: z.number().min(0).max(100),
      S: z.number().min(0).max(100),
      B: z.number().min(0).max(100),
      E: z.number().min(0).max(100),
    })
    .default({ R: 10, C: 25, S: 40, B: 10, E: 15 }),
});

export type AnalyticsSettings = z.infer<typeof analyticsSettingsSchema>;
export const DEFAULT_ANALYTICS_SETTINGS: AnalyticsSettings = analyticsSettingsSchema.parse({});

/** The marks of a question: its own, or the default for its tier. */
export function marksFor(
  question: { readonly tier: number; readonly marks?: number | undefined },
  settings: AnalyticsSettings = DEFAULT_ANALYTICS_SETTINGS,
): number {
  return question.marks ?? settings.marksByTier[String(question.tier)] ?? question.tier;
}
