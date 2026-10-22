import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COSMETICS,
  DEFAULT_PROGRESSION_SETTINGS as S,
  progressionSettingsSchema,
} from '../config/progression';
import { activeSeason, seasonView } from './season';

const season = S.seasons[0];
if (!season) throw new Error('no default season');

describe('seasons', () => {
  it('finds the season running on a day, first and last day included', () => {
    expect(activeSeason(S, '2026-09-21')).toBeUndefined();
    expect(activeSeason(S, '2026-09-22')?.id).toBe('autumn-heist');
    expect(activeSeason(S, '2026-12-21')?.id).toBe('autumn-heist');
    expect(activeSeason(S, '2026-12-22')).toBeUndefined();
  });

  it('shows the track with the steps reached and the days left', () => {
    const v = seasonView(season, 350, '2026-12-20', S);
    expect(v).toMatchObject({ level: 2, xp: 350, daysLeft: 2, active: true, theme: 'autumn' });
    expect(v.track.map((t) => t.unlocked)).toEqual([true, true, false, false]);
    expect(v.track[1]).toMatchObject({ cosmetic: 'mask-pumpkin', cosmeticName: 'Pumpkin mask' });
    expect(seasonView(season, 0, '2027-01-05', S)).toMatchObject({ daysLeft: 0, active: false });
  });

  it('is a free track: every reward is a cosmetic that is earned only by season XP', () => {
    for (const step of season.track) {
      const c = DEFAULT_COSMETICS.find((x) => x.id === step.cosmetic);
      expect(c, step.cosmetic).toBeDefined();
      expect(c?.unlock.season).toEqual({ id: season.id, xp: step.xp });
      expect(c?.unlock.rank).toBeUndefined();
    }
  });

  it('refuses seasons that overlap', () => {
    const a = { ...season, id: 'a', start: '2026-01-01', end: '2026-03-01' };
    const b = { ...season, id: 'b', start: '2026-02-01', end: '2026-04-01' };
    expect(progressionSettingsSchema.safeParse({ seasons: [a, b] }).success).toBe(false);
    expect(
      progressionSettingsSchema.safeParse({ seasons: [a, { ...b, start: '2026-03-02' }] }).success,
    ).toBe(true);
  });
});
