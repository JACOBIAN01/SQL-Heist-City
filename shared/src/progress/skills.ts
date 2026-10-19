import type { ProgressionSettings, SkillNode } from '../config/progression';

/** Marks a student has earned of those available on a topic, from counted questions. */
export interface TopicMarks {
  readonly earned: number;
  readonly available: number;
  readonly items: number;
}

export type SkillState = 'locked' | 'open' | 'mastered';

/** One node as the student sees it (Phase 26.2). */
export interface SkillView {
  readonly id: string;
  readonly name: string;
  readonly state: SkillState;
  /** Share of marks earned on the node's topics (0–1); null when nothing has been tried. */
  readonly progress: number | null;
  readonly items: number;
  readonly requires: readonly string[];
  /** 0 for roots, 1 + the deepest requirement otherwise, so a tree can be drawn in rows. */
  readonly depth: number;
}

/**
 * Where a student stands in the tree. A node is **mastered** once enough questions on its topics
 * (`minItems`) have earned the mastery share of their marks; it is **open** when everything it
 * requires is mastered (roots are always open); otherwise **locked**. Mastery is judged on what
 * the student has done, not on the clock, so a rest never locks anything again.
 */
export function skillTree(
  topics: ReadonlyMap<string, TopicMarks> | Readonly<Record<string, TopicMarks>>,
  settings: ProgressionSettings,
): SkillView[] {
  const get = (t: string): TopicMarks | undefined =>
    topics instanceof Map ? topics.get(t) : (topics as Record<string, TopicMarks>)[t];
  const { tree, masteryShare, minItems } = settings.skills;
  const byId = new Map(tree.map((n) => [n.id, n]));
  const depth = new Map<string, number>();
  const depthOf = (n: SkillNode): number => {
    const known = depth.get(n.id);
    if (known !== undefined) return known;
    const d = n.requires.length
      ? 1 + Math.max(...n.requires.map((r) => depthOf(byId.get(r) as SkillNode)))
      : 0;
    depth.set(n.id, d);
    return d;
  };

  const mastered = new Map<string, boolean>();
  const views = new Map<string, Omit<SkillView, 'state'> & { own: boolean }>();
  for (const n of tree) {
    let earned = 0;
    let available = 0;
    let items = 0;
    for (const t of n.topics) {
      const m = get(t);
      if (!m) continue;
      earned += m.earned;
      available += m.available;
      items += m.items;
    }
    const progress = available > 0 ? Math.min(1, earned / available) : null;
    const own = items >= minItems && progress !== null && progress >= masteryShare;
    mastered.set(n.id, own);
    views.set(n.id, {
      id: n.id,
      name: n.name,
      progress,
      items,
      requires: n.requires,
      depth: depthOf(n),
      own,
    });
  }
  return tree.map((n) => {
    const v = views.get(n.id) as NonNullable<ReturnType<typeof views.get>>;
    const unlocked = n.requires.every((r) => mastered.get(r) === true);
    const { own, ...rest } = v;
    // Having mastered a node whose prerequisites are not yet (a reshaped tree, or ground covered
    // out of order) still shows as mastered: the work was done.
    const state: SkillState = own ? 'mastered' : unlocked ? 'open' : 'locked';
    return { ...rest, state };
  });
}
