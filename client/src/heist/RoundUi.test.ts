import { describe, expect, it, vi } from 'vitest';
import type { RoundView } from '../ui/hud/ScoreboardView';
import { RoundUi } from './RoundUi';

function setup() {
  const view: RoundView = {
    setTimer: vi.fn(),
    setScores: vi.fn(),
    setStanding: vi.fn(),
    setBoardVisible: vi.fn(),
    showResults: vi.fn(),
    setNextIn: vi.fn(),
    hideResults: vi.fn(),
  };
  return { view, ui: new RoundUi(view) };
}
const last = (fn: unknown) => (fn as ReturnType<typeof vi.fn>).mock.lastCall?.[0];

describe('RoundUi', () => {
  it('counts the round clock down locally between server messages', () => {
    const { view, ui } = setup();
    ui.onRound({ t: 'round', phase: 'playing', endsInSec: 125 }, 1_000);
    expect(last(view.setTimer)).toBe('2:05');
    ui.update(66_000);
    expect(last(view.setTimer)).toBe('1:00');
    ui.update(500_000);
    expect(last(view.setTimer)).toBe('0:00');
  });

  it('shows the results and the countdown to the next round when the round ends', () => {
    const { view, ui } = setup();
    const winner = { id: 2, name: 'Ana', banked: 9_000, kills: 1 };
    const awards = [{ id: 'top_gun' as const, playerId: 2, name: 'Ana', value: 3 }];
    ui.onRound(
      { t: 'round', phase: 'ended', nextInSec: 20, winner, standings: [winner], awards },
      0,
    );
    expect(view.showResults).toHaveBeenCalledWith(winner, [winner], awards);
    expect(last(view.setTimer)).toBeUndefined();
    ui.update(5_000);
    expect(last(view.setNextIn)).toBeCloseTo(15, 0);
  });

  it('clears the results when the next round starts', () => {
    const { view, ui } = setup();
    ui.onRound(
      { t: 'round', phase: 'ended', nextInSec: 1, winner: null, standings: [], awards: [] },
      0,
    );
    ui.onRound({ t: 'round', phase: 'playing', endsInSec: 900 }, 1_000);
    expect(view.hideResults).toHaveBeenCalled();
    expect(last(view.setTimer)).toBe('15:00');
  });

  it('passes scores and standing through', () => {
    const { view, ui } = setup();
    ui.onScores({ t: 'scores', top: [], players: 3 });
    ui.onStanding({ t: 'standing', rank: 2, players: 3 });
    expect(view.setScores).toHaveBeenCalledWith([], 3);
    expect(view.setStanding).toHaveBeenCalledWith(2, 3);
  });

  it('does nothing before the first round message', () => {
    const { view, ui } = setup();
    ui.update(1_000);
    expect(view.setTimer).not.toHaveBeenCalled();
    expect(view.setNextIn).not.toHaveBeenCalled();
  });
});
