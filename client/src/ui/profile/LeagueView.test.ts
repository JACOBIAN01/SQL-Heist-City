import axe from 'axe-core';
import { afterEach, describe, expect, it } from 'vitest';
import type { LeagueMessage } from '@heist/shared';
import { I18n } from '../../i18n/I18n';
import { LeagueView } from './LeagueView';

afterEach(() => document.body.replaceChildren());
const message = (rows: LeagueMessage['rows']): LeagueMessage => ({
  t: 'league',
  week: { start: '2026-10-19', end: '2026-10-26' },
  rows,
});

describe('LeagueView', () => {
  it('lists the table with learning and cash apart and marks the student, with ties sharing a number', () => {
    const v = new LeagueView(new I18n('en'));
    document.body.append(v.root);
    v.update(
      message([
        { rank: 1, name: 'Cleo', points: 140, learningPoints: 120, cashPoints: 5, you: false },
        { rank: 1, name: 'Dev', points: 140, learningPoints: 100, cashPoints: 25, you: true },
        { rank: 3, name: 'Eli', points: 90, learningPoints: 40, cashPoints: 35, you: false },
      ]),
    );
    const items = [...v.root.querySelectorAll('li')];
    expect(items.map((li) => li.getAttribute('value'))).toEqual(['1', '1', '3']);
    expect(items[1]?.textContent).toContain('Dev (you)');
    expect(items[1]?.textContent).toContain('140 pts');
    expect(items[1]?.textContent).toContain('100 learning · 25 cash');
    expect(v.root.textContent).toContain('Week of 2026-10-19');
  });

  it('says so when nothing is known or nobody has played', () => {
    const v = new LeagueView(new I18n('en'));
    document.body.append(v.root);
    expect(v.root.textContent).toContain('The league shows in a class room.');
    v.update(message([]));
    expect(v.root.textContent).toContain('Nobody has played');
  });

  it('passes the structural accessibility check', async () => {
    const v = new LeagueView(new I18n('en'));
    document.body.append(v.root);
    v.hidden = false;
    v.update(
      message([{ rank: 1, name: 'A', points: 1, learningPoints: 1, cashPoints: 0, you: true }]),
    );
    const r = await axe.run(v.root, {
      rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
    });
    expect(r.violations.map((x) => x.id)).toEqual([]);
  });
});
