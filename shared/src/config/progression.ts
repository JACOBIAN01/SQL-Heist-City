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

/** One node of the skill tree: a group of topics, unlocked by mastering what it requires. */
export const skillNodeSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  name: z.string().min(1).max(40),
  /** Question topics (kebab-case, as in the question files) that count toward this node. */
  topics: z.array(z.string().min(1)).min(1),
  /** Node ids that must be mastered before this one opens. */
  requires: z.array(z.string()).default([]),
});
export type SkillNode = z.infer<typeof skillNodeSchema>;

const node = (id: string, name: string, topics: string[], requires: string[] = []): SkillNode => ({
  id,
  name,
  topics,
  requires,
});

/** The tree as shipped; an admin can reshape it. Topic names are those used by the question files. */
export const DEFAULT_SKILL_TREE: readonly SkillNode[] = [
  node('select', 'Selecting', ['select', 'text']),
  node(
    'filter',
    'Filtering',
    ['where', 'and', 'or', 'not', 'in', 'between', 'like', 'null'],
    ['select'],
  ),
  node('sort', 'Sorting and paging', ['order-by', 'limit', 'offset', 'distinct'], ['select']),
  node('functions', 'Text and dates', ['string', 'dates'], ['filter']),
  node('aggregates', 'Aggregates', ['count', 'sum', 'avg', 'min-max', 'aggregate'], ['filter']),
  node('grouping', 'Grouping', ['group-by', 'having'], ['aggregates']),
  node('conditions', 'CASE and NULLs', ['case', 'coalesce'], ['filter']),
  node('joins', 'Joins', ['join', 'left-join'], ['filter', 'sort']),
  node('many-joins', 'Many and self joins', ['multi-join', 'self-join'], ['joins']),
  node('sets', 'Set operations', ['union', 'intersect', 'except'], ['joins']),
  node(
    'subqueries',
    'Subqueries',
    ['subquery', 'scalar', 'exists', 'not-exists', 'not-in', 'correlated-subquery'],
    ['joins', 'grouping'],
  ),
  node('ctes', 'CTEs', ['cte'], ['subqueries']),
  node('recursion', 'Recursive CTEs', ['recursive-cte', 'graph'], ['ctes']),
  node(
    'windows',
    'Window functions',
    ['window', 'row-number', 'rank', 'dense-rank', 'ntile'],
    ['grouping', 'ctes'],
  ),
  node(
    'window-frames',
    'Frames and offsets',
    ['lag', 'lead', 'first-value', 'running-total', 'moving-average', 'range', 'percentile'],
    ['windows'],
  ),
  node('patterns', 'Query patterns', ['top-n', 'gaps-islands', 'pivot', 'analytics'], ['windows']),
  node(
    'data-changes',
    'Changing data',
    ['insert', 'update', 'delete', 'create-table', 'index'],
    ['filter'],
  ),
];

/** Every `requires` points at a node that exists, and there is no loop. */
function treeProblem(tree: readonly SkillNode[]): string | undefined {
  const ids = new Set(tree.map((n) => n.id));
  if (ids.size !== tree.length) return 'two nodes share an id';
  for (const n of tree)
    for (const r of n.requires) if (!ids.has(r)) return `${n.id} needs unknown ${r}`;
  const state = new Map<string, 'visiting' | 'done'>();
  const byId = new Map(tree.map((n) => [n.id, n]));
  const visit = (id: string): boolean => {
    if (state.get(id) === 'done') return true;
    if (state.get(id) === 'visiting') return false;
    state.set(id, 'visiting');
    for (const r of byId.get(id)?.requires ?? []) if (!visit(r)) return false;
    state.set(id, 'done');
    return true;
  };
  return tree.every((n) => visit(n.id)) ? undefined : 'the tree has a loop';
}

export const COSMETIC_SLOTS = ['outfit', 'mask', 'paint'] as const;
export type CosmeticSlot = (typeof COSMETIC_SLOTS)[number];
export const MASK_SHAPES = ['bandana', 'visor', 'balaclava', 'clown'] as const;
export type MaskShape = (typeof MASK_SHAPES)[number];

/**
 * A cosmetic (Phase 26.3): earned by rank or by mastering a skill, never bought or won from a
 * box. It changes how a player looks to everyone and nothing else.
 */
export const cosmeticSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  slot: z.enum(COSMETIC_SLOTS),
  name: z.string().min(1).max(40),
  /** Shirt colour (outfit), mask colour, or car colour (paint), as 0xRRGGBB. */
  color: z.number().int().min(0).max(0xffffff),
  /** Mask masks only: which shape. */
  shape: z.enum(MASK_SHAPES).optional(),
  unlock: z
    .object({
      /** A rank name from `ranks`; reaching it unlocks the item. */
      rank: z.string().optional(),
      /** A skill-tree node id; mastering it unlocks the item. */
      skill: z.string().optional(),
      /** A season track level: earning that much XP in the season unlocks it for good (26.7). */
      season: z.object({ id: z.string(), xp: z.number().int().min(0) }).optional(),
    })
    .default({}),
});
export type Cosmetic = z.infer<typeof cosmeticSchema>;

const item = (
  id: string,
  slot: CosmeticSlot,
  name: string,
  color: number,
  unlock: Cosmetic['unlock'],
  shape?: MaskShape,
): Cosmetic => ({ id, slot, name, color, unlock, ...(shape ? { shape } : {}) });

export const DEFAULT_COSMETICS: readonly Cosmetic[] = [
  item('outfit-street', 'outfit', 'Street grey', 0x7f8c8d, {}),
  item('outfit-crimson', 'outfit', 'Crimson jacket', 0xc0392b, { rank: 'Lookout' }),
  item('outfit-teal', 'outfit', 'Teal hoodie', 0x16a085, { rank: 'Runner' }),
  item('outfit-gold', 'outfit', 'Gold jacket', 0xd4a017, { rank: 'Safecracker' }),
  item('outfit-night', 'outfit', 'Night suit', 0x1b2631, { skill: 'grouping' }),
  item('outfit-violet', 'outfit', 'Violet coat', 0x8e44ad, { skill: 'windows' }),
  item('mask-bandana', 'mask', 'Bandana', 0xc0392b, { rank: 'Lookout' }, 'bandana'),
  item('mask-visor', 'mask', 'Visor', 0x2980b9, { skill: 'joins' }, 'visor'),
  item('mask-balaclava', 'mask', 'Balaclava', 0x222222, { rank: 'Cracker' }, 'balaclava'),
  item('mask-clown', 'mask', 'Party mask', 0xf1c40f, { skill: 'subqueries' }, 'clown'),
  item('paint-red', 'paint', 'Racing red', 0xc0392b, { rank: 'Runner' }),
  item('paint-blue', 'paint', 'Deep blue', 0x2c5aa0, { skill: 'aggregates' }),
  item('paint-black', 'paint', 'Matte black', 0x2b2b2b, { rank: 'Fixer' }),
  item('paint-gold', 'paint', 'Gold', 0xd4a017, { rank: 'Mastermind' }),
  // Autumn Heist track (26.7)
  item('outfit-autumn', 'outfit', 'Autumn jacket', 0xb7570b, {
    season: { id: 'autumn-heist', xp: 100 },
  }),
  item(
    'mask-pumpkin',
    'mask',
    'Pumpkin mask',
    0xe67e22,
    { season: { id: 'autumn-heist', xp: 300 } },
    'clown',
  ),
  item('paint-autumn', 'paint', 'Maple orange', 0xc8641c, {
    season: { id: 'autumn-heist', xp: 600 },
  }),
  item('outfit-harvest', 'outfit', 'Harvest coat', 0x6e4b1f, {
    season: { id: 'autumn-heist', xp: 1000 },
  }),
];

/**
 * A kind of daily contract (Phase 26.5). Each student is dealt a few each day from these; solving
 * the right questions fills them and pays XP. Contracts are short and always about SQL.
 */
export const CONTRACT_KINDS = ['topic', 'tier', 'clean'] as const;
export type ContractKind = (typeof CONTRACT_KINDS)[number];

export const contractTemplateSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  /** `topic`: solve questions of a skill-tree node's topics. `tier`: of at least a tier. `clean`: right first time. */
  kind: z.enum(CONTRACT_KINDS),
  /** For `topic`: a skill-tree node id. */
  skill: z.string().optional(),
  /** For `tier`: the lowest tier that counts. */
  tier: z.number().int().min(1).max(5).optional(),
  /** Questions to solve. */
  count: z.number().int().min(1).max(20),
  /** XP paid when it is done. */
  xp: z.number().int().min(0),
});
export type ContractTemplate = z.infer<typeof contractTemplateSchema>;

const contract = (
  id: string,
  kind: ContractKind,
  count: number,
  xp: number,
  extra: Partial<ContractTemplate> = {},
): ContractTemplate => ({ id, kind, count, xp, ...extra });

export const DEFAULT_CONTRACTS: readonly ContractTemplate[] = [
  contract('filter-3', 'topic', 3, 40, { skill: 'filter' }),
  contract('sort-2', 'topic', 2, 30, { skill: 'sort' }),
  contract('aggregates-3', 'topic', 3, 50, { skill: 'aggregates' }),
  contract('grouping-2', 'topic', 2, 50, { skill: 'grouping' }),
  contract('joins-3', 'topic', 3, 60, { skill: 'joins' }),
  contract('subqueries-2', 'topic', 2, 70, { skill: 'subqueries' }),
  contract('windows-2', 'topic', 2, 80, { skill: 'windows' }),
  contract('tier2-3', 'tier', 3, 60, { tier: 2 }),
  contract('tier3-2', 'tier', 2, 80, { tier: 3 }),
  contract('clean-3', 'clean', 3, 50),
  contract('clean-5', 'clean', 5, 90),
];

/**
 * A season (Phase 26.7): a few weeks with a theme and a free track. XP earned while it runs fills
 * the track; each step unlocks a cosmetic for good. There is nothing to buy and no second, paid
 * track.
 */
export const seasonSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  name: z.string().min(1).max(40),
  /** A word or two for the look of the season ("autumn"), shown with it. */
  theme: z.string().max(30).default(''),
  /** First and last day (UTC, `YYYY-MM-DD`). */
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** The track: season XP needed for each step, in order, and the cosmetic it unlocks. */
  track: z
    .array(z.object({ xp: z.number().int().min(1), cosmetic: z.string() }))
    .min(1)
    .max(30),
});
export type Season = z.infer<typeof seasonSchema>;

export const DEFAULT_SEASONS: readonly Season[] = [
  {
    id: 'autumn-heist',
    name: 'Autumn Heist',
    theme: 'autumn',
    start: '2026-09-22',
    end: '2026-12-21',
    track: [
      { xp: 100, cosmetic: 'outfit-autumn' },
      { xp: 300, cosmetic: 'mask-pumpkin' },
      { xp: 600, cosmetic: 'paint-autumn' },
      { xp: 1000, cosmetic: 'outfit-harvest' },
    ],
  },
];

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
  /** The skill tree (26.2): what a student has to master to open the next topics. */
  skills: z
    .object({
      /** Share of the marks available on a node's topics a student must have earned. */
      masteryShare: z.number().min(0.1).max(1).default(0.7),
      /** Counted questions needed on a node's topics before it can be mastered. */
      minItems: z.number().int().min(1).default(3),
      tree: z
        .array(skillNodeSchema)
        .min(1)
        .refine((t) => treeProblem(t) === undefined, 'the tree must be a valid tree')
        .default([...DEFAULT_SKILL_TREE]),
    })
    .default({ masteryShare: 0.7, minItems: 3, tree: [...DEFAULT_SKILL_TREE] }),
  /** Daily contracts (26.5) and the day streak they keep. */
  contracts: z
    .object({
      /** Contracts dealt each day. */
      perDay: z.number().int().min(1).max(6).default(3),
      templates: z
        .array(contractTemplateSchema)
        .refine((t) => new Set(t.map((x) => x.id)).size === t.length, 'two contracts share an id')
        .default([...DEFAULT_CONTRACTS]),
      /** Extra share of contract XP for each day in a row with a finished contract, up to `streakCap` days. */
      streakBonusPerDay: z.number().min(0).max(1).default(0.1),
      streakCap: z.number().int().min(0).default(7),
      /** Days of past contracts kept (older ones are deleted; the streak itself is kept). */
      keepDays: z.number().int().min(1).default(30),
    })
    .default({
      perDay: 3,
      templates: [...DEFAULT_CONTRACTS],
      streakBonusPerDay: 0.1,
      streakCap: 7,
      keepDays: 30,
    }),
  /**
   * The weekly class league (26.6): points from learning count more than points from cash.
   * Cash is capped, so the richest player cannot win without learning.
   */
  league: z
    .object({
      /** Points per mark earned on counted questions in the week. */
      pointsPerMark: z.number().min(0).default(10),
      /** Points per $1,000 banked in class rounds in the week… */
      pointsPerThousand: z.number().min(0).default(1),
      /** …up to this many points from cash in a week. */
      cashCap: z.number().min(0).default(100),
      /** Points for each round played. */
      pointsPerRound: z.number().min(0).default(5),
      /** How many students the table lists (the rest are cut). */
      show: z.number().int().min(1).max(200).default(30),
    })
    .default({
      pointsPerMark: 10,
      pointsPerThousand: 1,
      cashCap: 100,
      pointsPerRound: 5,
      show: 30,
    }),
  /** Seasons (26.7): the track runs while one is current. Dates may not overlap. */
  seasons: z
    .array(seasonSchema)
    .refine(
      (all) =>
        all.every((a, i) => all.every((b, j) => i === j || a.end < b.start || b.end < a.start)),
      'seasons may not overlap',
    )
    .default([...DEFAULT_SEASONS]),
  /** What can be unlocked by rank or by mastering a skill (26.3). */
  cosmetics: z
    .array(cosmeticSchema)
    .refine((c) => new Set(c.map((x) => x.id)).size === c.length, 'two cosmetics share an id')
    .default([...DEFAULT_COSMETICS]),
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
