import { afterEach, describe, expect, it } from 'vitest';
import { I18n } from '../../i18n/I18n';
import { CollectionView } from './CollectionView';

afterEach(() => document.body.replaceChildren());

describe('CollectionView', () => {
  it('says there is nothing to find before the server sends anything', () => {
    const v = new CollectionView(new I18n('en'));
    expect(v.panel.textContent).toContain('No data chips');
  });

  it('shows how many are found and each trivia card', () => {
    const v = new CollectionView(new I18n('en'));
    v.update({
      t: 'collection',
      near: [],
      total: 24,
      found: [{ id: 3, title: 'NULL is not equal', fact: 'NULL is never equal to NULL.' }],
    });
    expect(v.panel.textContent).toContain('1 of 24');
    expect(v.panel.textContent).toContain('NULL is never equal to NULL.');
  });
});
