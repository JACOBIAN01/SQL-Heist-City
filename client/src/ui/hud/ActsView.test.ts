import { describe, expect, it } from 'vitest';
import { I18n } from '../../i18n/I18n';
import { ActsView } from './ActsView';

const msg = (act: 'none' | 'setup' | 'heist' | 'getaway' | 'complete', over = {}) =>
  ({ t: 'acts', bank: 'bank-3', act, intel: 2, intelMax: 3, take: 12000, ...over }) as const;

describe('ActsView', () => {
  it('says which act you are in, with the intel or the take', () => {
    const v = new ActsView(new I18n('en'));
    expect(v.root.hidden).toBe(true);
    v.update(msg('setup'), 0);
    expect(v.root.textContent).toContain('Act 1');
    expect(v.root.textContent).toContain('2/3');
    v.update(msg('heist'), 0);
    expect(v.root.textContent).toContain('Act 2');
    v.update(msg('getaway'), 0);
    expect(v.root.textContent).toContain('Act 3');
    expect(v.root.textContent).toContain('$12,000');
  });

  it('shows a finished heist for a few seconds, and hides when there is none', () => {
    const v = new ActsView(new I18n('en'));
    v.update(msg('complete'), 0);
    expect(v.root.textContent).toContain('$12,000');
    v.frame(7000);
    expect(v.root.hidden).toBe(true);
    v.update(msg('setup'), 8000);
    v.update(msg('none'), 9000);
    expect(v.root.hidden).toBe(true);
  });
});
