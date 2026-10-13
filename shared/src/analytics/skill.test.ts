import { describe, expect, it } from 'vitest';
import { DEFAULT_ANALYTICS_SETTINGS as S, analyticsSettingsSchema } from '../questions/analytics';
import { NO_ADJUST, overallScore, shiftTiers, skillAdjust } from './skill';
import { addItem, emptyTotals, type ProfileTotals } from './profile';
import type { ItemRecord } from './items';

const item = (over: Partial<ItemRecord> = {}): ItemRecord => ({
  challengeId: 'c',
  questionId: 1,
  questionVersion: 1,
  rewardKey: 'x',
  tier: 1,
  rcsbe: 'S',
  bloom: 'apply',
  marks: 4,
  topics: [],
  outcome: 'solved',
  runs: 1,
  submits: 1,
  wrongSubmits: 0,
  hintsPaid: 0,
  secondsOpen: 9,
  tutorial: false,
  issuedAt: 0,
  finishedAt: 1,
  ...over,
});
const totals = (solved: number, failed: number): ProfileTotals => {
  let t = emptyTotals();
  for (let i = 0; i < solved; i++) t = addItem(t, item(), S);
  for (let i = 0; i < failed; i++) t = addItem(t, item({ outcome: 'expired', submits: 1 }), S);
  return t;
};

describe('skillAdjust (16.7)', () => {
  it('leaves a newcomer, and a strong student, with the normal game', () => {
    expect(skillAdjust(emptyTotals(), S)).toEqual(NO_ADJUST);
    expect(skillAdjust(totals(1, 1), S)).toEqual(NO_ADJUST); // too little evidence
    expect(skillAdjust(totals(8, 2), S)).toEqual(NO_ADJUST);
  });

  it('eases questions, gives more time and trims rewards for a struggling student', () => {
    expect(skillAdjust(totals(4, 6), S)).toEqual({
      tierShift: -1,
      ttlScale: 1.3,
      rewardScale: 0.8,
    }); // 40%
    expect(skillAdjust(totals(1, 9), S)).toEqual({
      tierShift: -2,
      ttlScale: 1.6,
      rewardScale: 0.6,
    }); // 10%
  });

  it('follows the bands and can be turned off', () => {
    expect(overallScore(totals(5, 5), S)).toBe(50);
    expect(skillAdjust(totals(5, 5), S)).toEqual(NO_ADJUST); // exactly at the band edge: not below it
    const off = analyticsSettingsSchema.parse({ skill: { enabled: false } });
    expect(skillAdjust(totals(1, 9), off)).toEqual(NO_ADJUST);
    const harsh = analyticsSettingsSchema.parse({
      skill: { low: { below: 90, tierShift: -3, ttlScale: 2, rewardScale: 0.5 } },
    });
    expect(skillAdjust(totals(8, 2), harsh).tierShift).toBe(-3);
  });

  it('shifts tier ranges but keeps them inside tiers 1–5', () => {
    expect(shiftTiers({ min: 5, max: 5 }, -2)).toEqual({ min: 3, max: 3 });
    expect(shiftTiers({ min: 1, max: 2 }, -2)).toEqual({ min: 1, max: 1 });
    expect(shiftTiers({ min: 3, max: 4 }, 0)).toEqual({ min: 3, max: 4 });
  });
});
