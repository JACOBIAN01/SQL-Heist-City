import { afterEach, describe, expect, it } from 'vitest';
import type { PayoutMessage } from '@heist/shared';
import { I18n } from '../../i18n/I18n';
import { PayoutView } from './PayoutView';

afterEach(() => document.body.replaceChildren());

const done: PayoutMessage = {
  t: 'payout',
  outcome: 'complete',
  bank: 'bank-3',
  total: 61_500,
  lines: [
    { id: 'vault', amount: 50_000 },
    { id: 'ghost', amount: 7_500 },
    { id: 'locks', amount: 1_500 },
    { id: 'other', amount: 2_500 },
  ],
  mastery: 145,
};

describe('PayoutView', () => {
  it('is hidden until a heist ends, then lays out the take, its parts and the mastery earned', () => {
    const v = new PayoutView(new I18n('en'));
    document.body.append(v.panel);
    expect(v.hidden).toBe(true);
    v.show(done);
    expect(v.hidden).toBe(false);
    expect(v.panel.querySelectorAll('tr')).toHaveLength(done.lines.length + 1);
    expect(v.panel.textContent).toContain('$61,500');
    expect(v.panel.textContent).toContain('Ghost');
    expect(v.panel.textContent).toContain('145');
  });

  it('says plainly when the getaway failed and what was lost', () => {
    const v = new PayoutView(new I18n('en'));
    v.show({
      t: 'payout',
      outcome: 'failed',
      bank: 'bank-1',
      total: 9_000,
      lines: [{ id: 'lost', amount: 9_000 }],
      mastery: 0,
    });
    expect(v.panel.textContent).toContain('Getaway failed');
    expect(v.panel.textContent).toContain('$9,000');
    expect(v.panel.textContent).not.toContain('mastery');
  });
});
