import type { AnalyticsSettings } from '../questions/analytics';
import type { TierRange } from '../config/challenges';
import { MAX_TIER, MIN_TIER } from '../questions/template';
import type { ProfileTotals } from './profile';

/** How a question is eased for a student who is struggling. */
export interface SkillAdjust {
  /** Added to the question tier (0 or negative). */
  readonly tierShift: number;
  /** The time limit is multiplied by this. */
  readonly ttlScale: number;
  /** Heal amounts are multiplied by this. */
  readonly rewardScale: number;
}

export const NO_ADJUST: SkillAdjust = { tierShift: 0, ttlScale: 1, rewardScale: 1 };

/** The share of marks earned over every counted question (all dimensions together), or null with too little evidence. */
export function overallScore(totals: ProfileTotals, settings: AnalyticsSettings): number | null {
  let earned = 0;
  let available = 0;
  let items = 0;
  for (const d of Object.values(totals.rcsbe)) {
    earned += d.earned;
    available += d.available;
    items += d.items;
  }
  if (items < settings.minItems || available < settings.minMarks) return null;
  return (earned / available) * 100;
}

/**
 * Eases questions for a student who scores low. A newcomer, with too little evidence
 * to judge, gets the normal game. Nothing ever makes a question harder than its tier.
 */
export function skillAdjust(totals: ProfileTotals, settings: AnalyticsSettings): SkillAdjust {
  const skill = settings.skill;
  if (!skill.enabled) return NO_ADJUST;
  const score = overallScore(totals, settings);
  if (score === null) return NO_ADJUST;
  const band =
    score < skill.veryLow.below ? skill.veryLow : score < skill.low.below ? skill.low : undefined;
  return band
    ? { tierShift: band.tierShift, ttlScale: band.ttlScale, rewardScale: band.rewardScale }
    : NO_ADJUST;
}

/** A tier range moved by `shift` (a negative number), kept inside the tiers that exist. */
export function shiftTiers(range: TierRange, shift: number): TierRange {
  const clamp = (t: number) => Math.max(MIN_TIER, Math.min(MAX_TIER, t));
  return { min: clamp(range.min + shift), max: clamp(range.max + shift) };
}
