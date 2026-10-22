import type { AxisScore } from '../analytics/profile';
import type { CosmeticView, LookChoice } from './cosmetics';
import type { SeasonView } from './season';
import type { SkillView } from './skills';
import type { ProgressView } from './xp';

/** One finished round in a student's history. */
export interface RoundHistoryEntry {
  readonly classId: number;
  readonly round: number;
  readonly endedAt: string;
  readonly rank: number;
  readonly players: number;
  readonly banked: number;
  readonly kills: number;
}

/**
 * Everything on a student's own profile page (Phase 26.9): rank, what they have mastered, how
 * their rounds went, and what they can wear. Only ever sent to the student themselves, from real
 * records; nothing here is made up.
 */
export interface PlayerProfilePage {
  readonly name: string;
  readonly progress: ProgressView;
  readonly skills: readonly SkillView[];
  /** The two radar lenses over everything the student has done. */
  readonly mastery: { readonly rcsbe: readonly AxisScore[]; readonly bloom: readonly AxisScore[] };
  /** Days in a row with a finished daily contract. */
  readonly streakDays: number;
  readonly season?: SeasonView;
  readonly wardrobe: { readonly items: readonly CosmeticView[]; readonly choice: LookChoice };
  /** Latest first. */
  readonly history: readonly RoundHistoryEntry[];
}
