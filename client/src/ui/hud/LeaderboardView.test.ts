import { describe, expect, it } from 'vitest';
import type { LeaderboardMessage } from '@heist/shared';
import { I18n } from '../../i18n/I18n';
import { LeaderboardView } from './LeaderboardView';

const msg: LeaderboardMessage = {
  t: 'leaderboard',
  question: 'Payroll Leak',
  newBest: true,
  you: { scanned: 40, length: 50 },
  class: {
    rank: 2,
    of: 9,
    top: [
      { rank: 1, name: 'Ben', scanned: 12, length: 60, you: false },
      { rank: 2, name: 'Ana', scanned: 40, length: 50, you: true },
    ],
  },
  global: { rank: 30, of: 210, top: [{ rank: 1, name: 'Cy', scanned: 5, length: 20, you: false }] },
};

describe('LeaderboardView', () => {
  it('says there is nothing yet, then shows both tables with the student marked', () => {
    const v = new LeaderboardView(new I18n('en'));
    expect(v.panel.textContent).toContain('Solve a write question');
    v.update(msg);
    expect(v.panel.querySelector('[data-board="Your class"]')?.textContent).toContain('2 of 9');
    expect(v.panel.querySelector('[data-board="Everyone"]')?.textContent).toContain('30 of 210');
    expect(v.panel.textContent).toContain('Ana (you)');
    expect(v.panel.textContent).toContain('Payroll Leak');
  });

  it('puts the class place in the toast, and says when it is a new best', () => {
    const v = new LeaderboardView(new I18n('en'));
    expect(v.toastFor(msg)).toContain('#2 of 9');
    expect(v.toastFor(msg)).toContain('New best');
    expect(v.toastFor({ ...msg, newBest: false })).not.toContain('New best');
  });

  it('falls back to the whole game when the student is not in a class', () => {
    const { class: _c, ...open } = msg;
    expect(new LeaderboardView(new I18n('en')).toastFor(open)).toContain('#30 of 210');
  });
});
