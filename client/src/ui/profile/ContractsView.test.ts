import axe from 'axe-core';
import { afterEach, describe, expect, it } from 'vitest';
import type { ContractsMessage } from '@heist/shared';
import { I18n } from '../../i18n/I18n';
import { ContractsView } from './ContractsView';

afterEach(() => document.body.replaceChildren());
const message = (over: Partial<ContractsMessage> = {}): ContractsMessage => ({
  t: 'contracts',
  day: '2026-10-20',
  streak: { days: 3, bonusPct: 20 },
  contracts: [
    { id: 'joins-3', kind: 'topic', skill: 'Joins', count: 3, xp: 60, progress: 1, done: false },
    { id: 'tier3-2', kind: 'tier', tier: 3, count: 2, xp: 80, progress: 2, done: true },
    { id: 'clean-5', kind: 'clean', count: 5, xp: 90, progress: 0, done: false },
  ],
  ...over,
});

describe('ContractsView', () => {
  it('says what each contract asks, how far along it is, and the streak', () => {
    const v = new ContractsView(new I18n('en'));
    document.body.append(v.root);
    v.update(message());
    const text = (id: string) => v.root.querySelector(`[data-contract="${id}"]`)?.textContent ?? '';
    expect(text('joins-3')).toContain('Solve 3 Joins questions');
    expect(text('joins-3')).toContain('1 of 3');
    expect(text('joins-3')).toContain('60 XP');
    expect(text('tier3-2')).toContain('tier 3 or higher');
    expect(text('tier3-2')).toContain('Done');
    expect(text('clean-5')).toContain('right first time');
    expect(v.root.textContent).toContain('Day streak: 3 (+20% contract XP)');
  });

  it('invites a first contract when there is no streak, and copes with no contracts', () => {
    const v = new ContractsView(new I18n('en'));
    document.body.append(v.root);
    v.update(message({ streak: { days: 0, bonusPct: 0 }, contracts: [] }));
    expect(v.root.textContent).toContain('No streak yet');
    expect(v.root.textContent).toContain('No contracts today.');
  });

  it('passes the structural accessibility check', async () => {
    const v = new ContractsView(new I18n('en'));
    document.body.append(v.root);
    v.hidden = false;
    v.update(message());
    const r = await axe.run(v.root, {
      rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
    });
    expect(r.violations.map((x) => x.id)).toEqual([]);
  });
});
