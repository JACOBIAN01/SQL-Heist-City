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
