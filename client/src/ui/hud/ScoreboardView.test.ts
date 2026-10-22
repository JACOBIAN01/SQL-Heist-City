import { describe, expect, it } from 'vitest';
import { ScoreboardView, formatAward } from './ScoreboardView';

const host = () => {
  const el = document.createElement('div');
  document.body.append(el);
  return el;
};
const row = (id: number, name: string, banked: number, kills = 0) => ({ id, name, banked, kills });

describe('ScoreboardView', () => {
  it('shows the timer text and hides it when asked', () => {
    const el = host();
    const view = new ScoreboardView(el);
    const timer = el.querySelector('.hud-timer') as HTMLElement;
    expect(timer.hidden).toBe(true);
    view.setTimer('12:34');
    expect(timer.hidden).toBe(false);
    expect(timer.textContent).toBe('12:34');
    view.setTimer(undefined);
    expect(timer.hidden).toBe(true);
  });

  it('lists the leaders with money formatted, and highlights you', () => {
    const el = host();
    const view = new ScoreboardView(el, () => 2);
    view.setScores([row(1, 'Ana', 12_000, 2), row(2, 'Ben', 500)], 2);
    view.setBoardVisible(true);
    const rows = [...el.querySelectorAll('.hud-board tbody tr')];
    expect(rows.map((r) => r.textContent)).toEqual(['1Ana$12,0002', '2Ben$5000']);
    expect(rows[1]?.classList.contains('me')).toBe(true);
    expect((el.querySelector('.hud-board') as HTMLElement).hidden).toBe(false);
    view.setBoardVisible(false);
    expect((el.querySelector('.hud-board') as HTMLElement).hidden).toBe(true);
  });

  it('shows your rank', () => {
    const el = host();
    const view = new ScoreboardView(el);
    view.setStanding(34, 80);
    expect(el.querySelector('.hud-standing')?.textContent).toBe('You: #34 of 80');
  });

  it('shows the winner and a countdown, then hides the results', () => {
    const el = host();
    const view = new ScoreboardView(el);
    const ana = row(1, 'Ana', 9_000);
    view.showResults(ana, [ana]);
    const results = el.querySelector('.hud-results') as HTMLElement;
    expect(results.hidden).toBe(false);
    expect(results.textContent).toContain('Ana wins with $9,000');
    view.setNextIn(14.2);
    expect(results.textContent).toContain('Next round in 15 s');
    view.hideResults();
    expect(results.hidden).toBe(true);
    view.showResults(null, []);
    expect(results.textContent).toContain('Nobody banked any cash');
  });

  it('offers the planning brief under the results, and removes it', () => {
    const el = host();
    const view = new ScoreboardView(el);
    let clicked = 0;
    view.showResults(null, []);
    view.setAction('Plan the next heist ✎', () => clicked++);
    const button = el.querySelector('.hud-results button') as HTMLButtonElement;
    expect(button.textContent).toBe('Plan the next heist ✎');
    button.click();
    expect(clicked).toBe(1);
    view.setAction(null);
    expect(el.querySelector('.hud-results button')).toBeNull();
  });

  it('shows each award with its winner and number, and marks yours', () => {
    const el = host();
    const view = new ScoreboardView(el, () => 2);
    const ana = row(1, 'Ana', 9_000);
    view.showResults(
      ana,
      [ana],
      [
        { id: 'quick_draw', playerId: 2, name: 'Ben', value: 18.04 },
        { id: 'big_haul', playerId: 1, name: 'Ana', value: 9_000 },
      ],
    );
    const cards = [...el.querySelectorAll('.hud-award')];
    expect(cards.map((c) => c.querySelector('.hud-award-title')?.textContent)).toEqual([
      'Quick Draw',
      'Big Haul',
    ]);
    expect(cards[0]?.textContent).toContain('Ben (you)');
    expect(cards[0]?.textContent).toContain('18.0 s');
    expect(cards[0]?.classList.contains('me')).toBe(true);
    expect(cards[1]?.textContent).toContain('$9,000');
    view.showResults(null, [], []);
    expect(el.querySelector('.hud-awards')).toBeNull();
  });

  it('formats award numbers by unit', () => {
    expect(formatAward(12_000, 'money')).toBe('$12,000');
    expect(formatAward(3, 'count')).toBe('3');
    expect(formatAward(7.25, 'seconds')).toBe('7.3 s');
  });

  it('writes names as text, never as HTML', () => {
    const el = host();
    const view = new ScoreboardView(el);
    view.setScores([row(1, '<img src=x onerror=alert(1)>', 1)], 1);
    view.setBoardVisible(true);
    expect(el.querySelector('img')).toBeNull();
  });
});

describe('ScoreboardView with squads (27.5)', () => {
  const squads = [
    { squad: 1, name: 'Red', banked: 9000, kills: 3, locks: 2, solves: 7, members: 3 },
    { squad: 2, name: 'Blue', banked: 4000, kills: 6, locks: 1, solves: 2, members: 4 },
  ];

  it('adds a squad table to the board, with your squad marked, and none without squads', () => {
    const el = host();
    const view = new ScoreboardView(el, () => 1);
    view.mySquad = 2;
    view.setScores([row(1, 'Ana', 5000)], 1);
    expect(el.querySelector('.hud-squads')).toBeNull();
    view.setScores([row(1, 'Ana', 5000)], 1, squads);
    const rows = [...el.querySelectorAll('.hud-squads tbody tr')];
    expect(rows.map((r) => r.textContent)).toEqual(['1Red (3)$9,000327', '2Blue (4)$4,000612']);
    expect(rows[1]?.className).toBe('me');
  });

  it('shows the squad table and the squads’ awards when the round is over', () => {
    const el = host();
    const view = new ScoreboardView(el, () => 1);
    view.mySquad = 1;
    view.showResults(
      { id: 1, name: 'Ana', banked: 5000, kills: 1 },
      [row(1, 'Ana', 5000)],
      [],
      squads,
      [
        { id: 'top_haul', squad: 1, name: 'Red', value: 9000 },
        { id: 'wolfpack', squad: 2, name: 'Blue', value: 6 },
      ],
    );
    const results = el.querySelector('.hud-results') as HTMLElement;
    expect(results.textContent).toContain('Squads');
    expect(results.querySelector('.hud-squads')).not.toBeNull();
    const cards = [...results.querySelectorAll('.hud-squad-awards .hud-award')];
    expect(cards.map((c) => c.querySelector('.hud-award-title')?.textContent)).toEqual([
      'Top Haul',
      'Wolfpack',
    ]);
    expect(cards[0]?.textContent).toContain('Red (your squad)');
    expect(cards[0]?.className).toContain('me');
    expect(cards[1]?.className).not.toContain('me');
  });
});
