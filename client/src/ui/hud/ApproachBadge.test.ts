import { describe, expect, it } from 'vitest';
import { I18n } from '../../i18n/I18n';
import { ApproachBadge } from './ApproachBadge';

describe('ApproachBadge', () => {
  it('shows only while the server says you are moving quietly', () => {
    const b = new ApproachBadge(new I18n('en'));
    expect(b.root.hidden).toBe(true);
    b.update({ t: 'approach_state', mode: 'stealth' });
    expect(b.root.hidden).toBe(false);
    expect(b.root.textContent).toBe('STEALTH');
    b.update({ t: 'approach_state', mode: 'loud' });
    expect(b.root.hidden).toBe(true);
  });
});
