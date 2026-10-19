import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PROGRESSION_SETTINGS as S,
  progressionSettingsSchema,
} from '../config/progression';
import { learningXp, playXp, progressView } from './xp';

const solved = {
  outcome: 'solved' as const,
  tier: 3,
  tutorial: false,
  wrongSubmits: 0,
  hintsPaid: 0,
};

describe('learning XP', () => {
  it('pays by tier, with a bonus for getting it right first time', () => {
    expect(learningXp(solved, S, false)).toBe(Math.round(55 * 1.25));
    expect(learningXp({ ...solved, wrongSubmits: 1 }, S, false)).toBe(55);
  });

  it('takes a little off for each paid hint, and adds for a new topic', () => {
    expect(learningXp({ ...solved, wrongSubmits: 1, hintsPaid: 2 }, S, false)).toBe(
      Math.round(55 * 0.9 * 0.9),
    );
    expect(learningXp({ ...solved, wrongSubmits: 1 }, S, true)).toBe(Math.round(55 * 1.5));
  });

  it('pays a share for part marks, and nothing for the tutorial or unfinished tasks', () => {
    expect(
      learningXp({ ...solved, outcome: 'answered', share: 0.5, wrongSubmits: 1 }, S, false),
    ).toBe(Math.round(27.5));
    expect(learningXp({ ...solved, tutorial: true }, S, false)).toBe(0);
    for (const outcome of ['abandoned', 'expired', 'died', 'left', 'switched'] as const)
      expect(learningXp({ ...solved, outcome }, S, false)).toBe(0);
  });
});

describe('play XP', () => {
  it('rewards finishing, kills, banking and the podium', () => {
    expect(playXp({ rank: 1, banked: 2000, kills: 3 }, S)).toBe(20 + 12 + 16 + 40);
    expect(playXp({ rank: 9, banked: 0, kills: 0 }, S)).toBe(20);
  });

  it('is capped, so a fight-only round never beats steady learning', () => {
    expect(playXp({ rank: 1, banked: 90_000, kills: 80 }, S)).toBe(S.play.roundCap);
    // One round of fighting at the cap equals a handful of mid-tier first-try solves.
    expect(S.play.roundCap).toBeLessThanOrEqual(3 * Math.round(55 * 1.25));
  });
});

describe('ranks', () => {
  it('finds the rank, the progress into it and the next step', () => {
    expect(progressView(0, 0, S)).toMatchObject({ rank: 'Rookie', into: 0, span: 100 });
    const v = progressView(250, 100, S);
    expect(v).toMatchObject({ xp: 350, rank: 'Runner', nextRank: 'Cracker', into: 50, span: 400 });
    expect(progressView(99999, 0, S)).toMatchObject({ rank: 'Mastermind', span: 0 });
  });

  it('copes with ranks listed out of order', () => {
    const odd = progressionSettingsSchema.parse({
      ranks: [
        { name: 'B', minXp: 50 },
        { name: 'A', minXp: 0 },
      ],
    });
    expect(progressView(60, 0, odd).rank).toBe('B');
  });
});
