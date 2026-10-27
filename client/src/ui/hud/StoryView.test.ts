import { afterEach, describe, expect, it } from 'vitest';
import type { StoryMessage } from '@heist/shared';
import { I18n } from '../../i18n/I18n';
import { StoryView } from './StoryView';

afterEach(() => document.body.replaceChildren());

const msg: StoryMessage = {
  t: 'story',
  pages: 1,
  chains: [
    {
      bank: 'bank-1',
      name: 'The first page',
      fixer: { name: 'Mae Okafor', role: 'former teller' },
      state: 'done',
      step: 3,
      total: 3,
      page: 'Deposits that never happened.',
    },
    {
      bank: 'bank-2',
      name: 'Two ledgers',
      fixer: { name: 'Dev Rao', role: 'auditor' },
      state: 'active',
      step: 1,
      total: 3,
      current: { title: 'Look around', text: 'Visit other banks.' },
    },
    {
      bank: 'bank-3',
      name: 'The numbers do not add up',
      fixer: { name: 'Inez Vega', role: 'analyst' },
      state: 'locked',
      step: 0,
      total: 3,
    },
  ],
};

describe('StoryView', () => {
  it('says there is no story before the server sends one', () => {
    const v = new StoryView(new I18n('en'));
    expect(v.panel.textContent).toContain('No story');
  });

  it('shows each chain as done, active or locked, with the page and the step to do now', () => {
    const v = new StoryView(new I18n('en'));
    v.update(msg);
    expect(v.panel.textContent).toContain('1 of 3');
    const done = v.panel.querySelector('[data-bank="bank-1"]');
    expect(done?.className).toContain('story-done');
    expect(done?.textContent).toContain('Deposits that never happened.');
    const active = v.panel.querySelector('[data-bank="bank-2"]');
    expect(active?.textContent).toContain('Step 2 of 3');
    expect(active?.textContent).toContain('Visit other banks.');
    expect(v.panel.querySelector('[data-bank="bank-3"]')?.textContent).toContain('Locked');
  });
});
