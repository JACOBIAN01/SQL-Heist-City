import type { ItemRecord } from '../analytics/items';
import type { ProgressionSettings, Rank } from '../config/progression';

/** What a player's progress is, for display. */
export interface ProgressView {
  readonly xp: number;
  readonly learningXp: number;
  readonly playXp: number;
  readonly rank: string;
  readonly rankIndex: number;
  /** XP into the current rank and the size of the step to the next (0 at the top). */
  readonly into: number;
  readonly span: number;
  readonly nextRank?: string;
}

/** The ranks sorted by XP (an admin may list them in any order). */
const sorted = (ranks: readonly Rank[]): Rank[] => [...ranks].sort((a, b) => a.minXp - b.minXp);

export function progressView(
  learningXp: number,
  playXp: number,
  settings: ProgressionSettings,
): ProgressView {
  const xp = Math.max(0, Math.floor(learningXp + playXp));
  const ranks = sorted(settings.ranks);
  let index = 0;
  ranks.forEach((r, i) => {
    if (xp >= r.minXp) index = i;
  });
  const current = ranks[index] as Rank;
  const next = ranks[index + 1];
  return {
    xp,
    learningXp: Math.floor(learningXp),
    playXp: Math.floor(playXp),
    rank: current.name,
    rankIndex: index,
    into: xp - current.minXp,
    span: next ? next.minXp - current.minXp : 0,
    ...(next ? { nextRank: next.name } : {}),
  };
}

/**
 * XP for one finished question. Only solved or fully answered questions earn; the tutorial,
 * abandoned, expired and similar outcomes earn nothing. Marks given in parts (multiple choice)
 * earn their share.
 */
export function learningXp(
  item: Pick<
    ItemRecord,
    'outcome' | 'tier' | 'tutorial' | 'wrongSubmits' | 'hintsPaid' | 'share' | 'assessment'
  >,
  settings: ProgressionSettings,
  /** True when the student has not recently got a question of this topic right. */
  newTopic: boolean,
): number {
  // The tutorial is free practice and a pre/post test is a test, not a game: neither earns XP.
  if (item.tutorial || item.assessment) return 0;
  if (item.outcome !== 'solved' && item.outcome !== 'answered') return 0;
  const tier = Math.min(5, Math.max(1, item.tier));
  let xp = settings.tierXp[tier - 1] ?? 0;
  xp *= item.share ?? 1;
  if (item.wrongSubmits === 0 && item.hintsPaid === 0) xp *= settings.firstTryBonus;
  xp *= settings.hintFactor ** item.hintsPaid;
  if (newTopic) xp *= settings.newTopicBonus;
  return Math.round(xp);
}

export interface RoundShare {
  readonly rank: number;
  readonly banked: number;
  readonly kills: number;
}

/** XP for a finished round of play, capped so fighting cannot outweigh learning. */
export function playXp(r: RoundShare, settings: ProgressionSettings): number {
  const p = settings.play;
  const raw =
    p.roundFinished +
    r.kills * p.perKill +
    (r.banked / 1000) * p.perThousandBanked +
    (p.podium[r.rank - 1] ?? 0);
  return Math.round(Math.min(raw, p.roundCap));
}
