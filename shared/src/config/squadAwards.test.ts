import { describe, expect, it } from 'vitest';
import { squadAwards } from './squadAwards';

const row = (
  squad: number,
  over: Partial<{ banked: number; kills: number; locks: number; solves: number }> = {},
) => ({
  squad,
  name: `S${squad}`,
  banked: 0,
  kills: 0,
  locks: 0,
  solves: 0,
  members: 3,
  ...over,
});

describe('squad awards', () => {
  it('gives each award to the squad with the most, one squad may win several', () => {
    const a = squadAwards([
      row(1, { banked: 9000, kills: 1, locks: 2, solves: 5 }),
      row(2, { banked: 4000, kills: 6, locks: 1, solves: 9 }),
    ]);
    expect(a).toEqual([
      { id: 'top_haul', squad: 1, name: 'S1', value: 9000 },
      { id: 'lock_breakers', squad: 1, name: 'S1', value: 2 },
      { id: 'wolfpack', squad: 2, name: 'S2', value: 6 },
      { id: 'brain_trust', squad: 2, name: 'S2', value: 9 },
    ]);
  });

  it('gives nothing for zero, and settles a tie for the lower squad number', () => {
    expect(squadAwards([row(1), row(2)])).toEqual([]);
    const tie = squadAwards([row(3, { kills: 4 }), row(2, { kills: 4 })]);
    expect(tie).toEqual([{ id: 'wolfpack', squad: 2, name: 'S2', value: 4 }]);
    expect(squadAwards([])).toEqual([]);
  });
});
