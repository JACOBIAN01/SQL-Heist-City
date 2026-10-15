import type { AnalyticsSettings, BloomLevel, RcsbeDimension } from '../questions/analytics';

/** How an issued question ended. */
export type ItemOutcome =
  | 'solved'
  /** The player closed the pop-up. */
  | 'abandoned'
  /** The time limit passed. */
  | 'expired'
  /** They asked for a different task. */
  | 'switched'
  | 'died'
  /** They disconnected. */
  | 'left';

export const ITEM_OUTCOMES: readonly ItemOutcome[] = [
  'solved',
  'abandoned',
  'expired',
  'switched',
  'died',
  'left',
];

/** Everything known about one issued question when it ended (docs/RCBSE.md §5.3, §6). */
export interface ItemRecord {
  readonly challengeId: string;
  /** The signed-in account behind the player; absent for unsigned play. */
  readonly accountId?: number;
  readonly classId?: number;
  /** Round within the class's match (for the per-round profile). */
  readonly round?: number;
  readonly questionId: number;
  readonly questionVersion: number;
  readonly rewardKey: string;
  readonly tier: number;
  /** Snapshots of the tags at the moment the question was issued: editing it later never rewrites history. */
  readonly rcsbe: RcsbeDimension;
  readonly bloom: BloomLevel;
  readonly marks: number;
  /** Topics of the question, for the drill-down. */
  readonly topics: readonly string[];
  readonly outcome: ItemOutcome;
  readonly runs: number;
  /** Graded submits, right or wrong (not counting ones refused for cooldown or lockout). */
  readonly submits: number;
  readonly wrongSubmits: number;
  /** Hints that were revealed and paid for. */
  readonly hintsPaid: number;
  /** Seconds the question was open. */
  readonly secondsOpen: number;
  /** The tutorial: the solution is free, so nothing counts. */
  readonly tutorial: boolean;
  readonly issuedAt: number;
  readonly finishedAt: number;
  /**
   * What the post-round review needs (Phase 16.2). Kept in memory for the round and sent to the
   * student after it ends; never saved to the database and never sent during the round.
   */
  readonly review?: ItemReview;
  /** Set when the question was part of a class's pre or post assessment: it then counts in that scope only. */
  readonly assessment?: 'pre' | 'post';
}

export interface ItemReview {
  readonly title: string;
  readonly story: string;
  /** The student's last query on this question, if they ran or submitted one. */
  readonly lastSql?: string;
  /** The reference answer for this student's own version of the question. */
  readonly modelSql: string;
}

export interface ItemScore {
  /** Whether the item counts toward the profile at all. */
  readonly counted: boolean;
  readonly available: number;
  readonly earned: number;
}

const NOT_COUNTED: ItemScore = { counted: false, available: 0, earned: 0 };

/**
 * What an issued question is worth to the profile (docs/RCBSE.md §6). The
 * profile measures ability, not luck under fire: a question opened and
 * dropped at once, or one a student was shot during before trying, shows
 * nothing; a question worked on and failed shows a real gap.
 */
export function scoreItem(item: ItemRecord, settings: AnalyticsSettings): ItemScore {
  if (item.tutorial) return NOT_COUNTED;
  const worked = item.runs + item.submits > 0;
  if (item.outcome === 'solved') {
    const kept = Math.max(settings.minEarnedShare, 1 - settings.hintPenalty * item.hintsPaid);
    return { counted: true, available: item.marks, earned: round2(item.marks * kept) };
  }
  if (item.outcome === 'died') {
    // Death before any graded attempt shows nothing; after one, it is a worked failure.
    return item.submits > 0 ? { counted: true, available: item.marks, earned: 0 } : NOT_COUNTED;
  }
  if (!worked && item.secondsOpen < settings.abandonSeconds) return NOT_COUNTED;
  return { counted: true, available: item.marks, earned: 0 };
}

const round2 = (n: number) => Math.round(n * 100) / 100;
