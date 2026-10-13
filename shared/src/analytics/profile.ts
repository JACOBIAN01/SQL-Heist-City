import {
  BLOOM_LEVELS,
  RCSBE_DIMENSIONS,
  type AnalyticsSettings,
  type BloomLevel,
  type RcsbeDimension,
} from '../questions/analytics';
import { scoreItem, type ItemRecord } from './items';

/** Marks earned and available on the items of one dimension, and how many items. Additive, so totals merge by plain addition. */
export interface ProfileTally {
  readonly earned: number;
  readonly available: number;
  readonly items: number;
}

export type Lens = 'rcsbe' | 'bloom';

/** A student's totals: `rcsbe` by dimension and `bloom` by level. */
export interface ProfileTotals {
  readonly rcsbe: Readonly<Record<RcsbeDimension, ProfileTally>>;
  readonly bloom: Readonly<Record<BloomLevel, ProfileTally>>;
}

const EMPTY: ProfileTally = { earned: 0, available: 0, items: 0 };

export function emptyTotals(): ProfileTotals {
  return {
    rcsbe: Object.fromEntries(RCSBE_DIMENSIONS.map((d) => [d, EMPTY])) as Record<
      RcsbeDimension,
      ProfileTally
    >,
    bloom: Object.fromEntries(BLOOM_LEVELS.map((b) => [b, EMPTY])) as Record<
      BloomLevel,
      ProfileTally
    >,
  };
}

const plus = (a: ProfileTally, b: ProfileTally): ProfileTally => ({
  earned: round2(a.earned + b.earned),
  available: round2(a.available + b.available),
  items: a.items + b.items,
});

/** The totals with one finished item added (or unchanged if it does not count). */
export function addItem(
  totals: ProfileTotals,
  item: ItemRecord,
  settings: AnalyticsSettings,
): ProfileTotals {
  const score = scoreItem(item, settings);
  if (!score.counted) return totals;
  const tally: ProfileTally = { earned: score.earned, available: score.available, items: 1 };
  return {
    rcsbe: { ...totals.rcsbe, [item.rcsbe]: plus(totals.rcsbe[item.rcsbe], tally) },
    bloom: { ...totals.bloom, [item.bloom]: plus(totals.bloom[item.bloom], tally) },
  };
}

/** Two sets of totals added together (marks pooled across rounds, classes and time; never averaged). */
export function mergeTotals(a: ProfileTotals, b: ProfileTotals): ProfileTotals {
  return {
    rcsbe: Object.fromEntries(
      RCSBE_DIMENSIONS.map((d) => [d, plus(a.rcsbe[d], b.rcsbe[d])]),
    ) as Record<RcsbeDimension, ProfileTally>,
    bloom: Object.fromEntries(BLOOM_LEVELS.map((l) => [l, plus(a.bloom[l], b.bloom[l])])) as Record<
      BloomLevel,
      ProfileTally
    >,
  };
}

export interface AxisScore {
  readonly dimension: string;
  readonly earned: number;
  readonly available: number;
  readonly items: number;
  /** 0–100, or null when there is not enough evidence to say. */
  readonly score: number | null;
  /** Items and marks reach the evidence thresholds. */
  readonly enough: boolean;
}

/** The score of every axis of a lens, with `null` where evidence is thin (shown as "not enough data", never as 0). */
export function axisScores(
  totals: ProfileTotals,
  lens: Lens,
  settings: AnalyticsSettings,
): AxisScore[] {
  const keys: readonly string[] = lens === 'rcsbe' ? RCSBE_DIMENSIONS : BLOOM_LEVELS;
  return keys.map((key) => {
    const t =
      lens === 'rcsbe' ? totals.rcsbe[key as RcsbeDimension] : totals.bloom[key as BloomLevel];
    const enough = t.items >= settings.minItems && t.available >= settings.minMarks;
    return {
      dimension: key,
      earned: t.earned,
      available: t.available,
      items: t.items,
      enough,
      score: enough && t.available > 0 ? round1((t.earned / t.available) * 100) : null,
    };
  });
}

/**
 * The remediation signal: the lowest axis that has enough evidence. Ties go
 * to the earlier axis (R before C …); no axis with enough evidence gives none.
 */
export function remediation(scores: readonly AxisScore[]): AxisScore | undefined {
  let lowest: AxisScore | undefined;
  for (const s of scores) {
    if (s.score === null) continue;
    if (!lowest || s.score < (lowest.score as number)) lowest = s;
  }
  return lowest;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;
