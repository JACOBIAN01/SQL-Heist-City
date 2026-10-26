import { afterEach, describe, expect, it } from 'vitest';
import { I18n } from '../../i18n/I18n';
import { PoliceStars } from './PoliceStars';

afterEach(() => document.body.replaceChildren());

describe('PoliceStars', () => {
  it('is hidden with no stars, and shows the lit stars out of the most there can be', () => {
    const v = new PoliceStars(new I18n('en'));
    document.body.append(v.root);
    expect(v.root.hidden).toBe(true);
    v.update({ t: 'police', stars: 3, max: 5 });
    expect(v.root.hidden).toBe(false);
    expect(v.root.querySelectorAll('.wanted-star')).toHaveLength(5);
    expect(v.root.querySelectorAll('.wanted-star.on')).toHaveLength(3);
    expect(v.root.getAttribute('aria-label')).toBe('Wanted level 3');
    v.update({ t: 'police', stars: 0, max: 5 });
    expect(v.root.hidden).toBe(true);
  });
});
