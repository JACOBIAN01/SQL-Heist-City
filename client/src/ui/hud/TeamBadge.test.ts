import { describe, expect, it } from 'vitest';
import { I18n } from '../../i18n/I18n';
import { TeamBadge } from './TeamBadge';

describe('TeamBadge', () => {
  it('is hidden until the server says which side you are on, then says it', () => {
    const b = new TeamBadge(new I18n('en'));
    expect(b.root.hidden).toBe(true);
    b.update({ t: 'team', role: 'cop' });
    expect(b.root.hidden).toBe(false);
    expect(b.root.textContent).toBe('COP');
    b.update({ t: 'team', role: 'robber' });
    expect(b.root.textContent).toBe('ROBBER');
    expect(b.root.dataset.team).toBe('robber');
  });
});
