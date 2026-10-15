import { describe, expect, it } from 'vitest';
import { runSoak } from './Soak';

describe('soak and reconnect chaos (19.5)', () => {
  it('players who drop mid-heist and come back keep their progress across rounds', () => {
    const report = runSoak({ players: 20, gameMinutes: 8, churn: 0.25, roundMinutes: 2 });
    expect(report.rounds).toBeGreaterThanOrEqual(2);
    expect(report.rejoins).toBeGreaterThan(10);
    expect(report.lostProgress).toEqual([]);
  }, 60_000);
});
