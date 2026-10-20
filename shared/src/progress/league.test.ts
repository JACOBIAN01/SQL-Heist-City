import { describe, expect, it } from 'vitest';
import { DEFAULT_PROGRESSION_SETTINGS as S } from '../config/progression';
import { addWeeks, isWeekStart, leagueTable, weekStartOf, type LeagueInput } from './league';

const who = (playerId: number, name: string, over: Partial<LeagueInput> = {}): LeagueInput => ({
  playerId,
  name,
  banked: 0,
  rounds: 0,
  earned: 0,
  available: 0,
  ...over,
});

describe('weeks', () => {
  it('starts a week on Monday (UTC)', () => {
    expect(weekStartOf(Date.UTC(2026, 9, 20, 12))).toBe('2026-10-19'); // a Tuesday
    expect(weekStartOf(Date.UTC(2026, 9, 19, 0, 0))).toBe('2026-10-19'); // Monday 00:00
    expect(weekStartOf(Date.UTC(2026, 9, 25, 23, 59))).toBe('2026-10-19'); // Sunday night
    expect(weekStartOf(Date.UTC(2026, 9, 26, 0, 0))).toBe('2026-10-26');
    expect(addWeeks('2026-10-19', -1)).toBe('2026-10-12');
    expect(addWeeks('2026-10-19', 2)).toBe('2026-11-02');
  });

  it('knows a week start from other days', () => {
    expect(isWeekStart('2026-10-19')).toBe(true);
    expect(isWeekStart('2026-10-20')).toBe(false);
    expect(isWeekStart('nonsense')).toBe(false);
  });
});

describe('league table', () => {
  it('ranks by points, learning counting for more than cash', () => {
    const t = leagueTable(
      [
        who(1, 'Rich', { banked: 900_000, rounds: 3, earned: 2, available: 10 }),
        who(2, 'Learner', { banked: 5_000, rounds: 3, earned: 12, available: 15 }),
      ],
      S,
    );
    expect(t.map((r) => r.name)).toEqual(['Learner', 'Rich']);
    // Rich: 2 marks → 20, cash 900 → capped at 100, 3 rounds → 15 = 135. Learner: 120 + 5 + 15 = 140.
    expect(t[0]).toMatchObject({
      points: 140,
      learningPoints: 120,
      cashPoints: 5,
      roundPoints: 15,
      rank: 1,
    });
    expect(t[1]).toMatchObject({ points: 135, cashPoints: 100, rank: 2 });
  });

  it('caps cash, so money alone cannot win', () => {
    const [top] = leagueTable([who(1, 'A', { banked: 10_000_000, rounds: 1 })], S);
    expect(top?.cashPoints).toBe(S.league.cashCap);
  });

  it('shares a rank on a tie, ordering by marks then name', () => {
    const t = leagueTable(
      [
        who(1, 'Zed', { earned: 10, rounds: 1 }),
        who(2, 'Amy', { earned: 10, rounds: 1 }),
        who(3, 'Bo', { earned: 5, rounds: 1 }),
      ],
      S,
    );
    expect(t.map((r) => [r.name, r.rank])).toEqual([
      ['Amy', 1],
      ['Zed', 1],
      ['Bo', 3],
    ]);
  });

  it('leaves out students who did nothing this week, and cuts the table at the limit', () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      who(i, `S${i}`, { earned: i + 1, rounds: 1 }),
    );
    const t = leagueTable([...many, who(99, 'Idle')], S);
    expect(t).toHaveLength(S.league.show);
    expect(t.some((r) => r.name === 'Idle')).toBe(false);
    expect(t[0]?.name).toBe('S39');
  });
});
