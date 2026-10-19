import axe from 'axe-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_PROGRESSION_SETTINGS as S,
  progressView,
  skillTree,
  wardrobe,
} from '@heist/shared';
import { I18n } from '../../i18n/I18n';
import { WardrobeView } from './WardrobeView';

afterEach(() => document.body.replaceChildren());
const message = (choice = {}) => ({
  t: 'wardrobe' as const,
  items: wardrobe(progressView(150, 0, S), skillTree(new Map(), S), S),
  choice,
});

describe('WardrobeView', () => {
  it('offers what is earned, says what locked things need, and asks the server to change', () => {
    const choose = vi.fn();
    const v = new WardrobeView(new I18n('en'), choose);
    document.body.append(v.root);
    v.update(message());
    const crimson = v.root.querySelector('[data-cosmetic="outfit-crimson"]') as HTMLElement;
    expect(crimson.dataset.unlocked).toBe('true');
    (crimson.querySelector('button') as HTMLButtonElement).click();
    expect(choose).toHaveBeenCalledWith('outfit', 'outfit-crimson');

    const gold = v.root.querySelector('[data-cosmetic="outfit-gold"]') as HTMLElement;
    expect(gold.dataset.unlocked).toBe('false');
    expect(gold.querySelector('button')).toBeNull();
    expect(gold.textContent).toContain('Reach rank Safecracker');
    expect(v.root.querySelector('[data-cosmetic="paint-blue"]')?.textContent).toContain(
      'Master Aggregates',
    );
  });

  it('shows what is worn and lets it be taken off', () => {
    const choose = vi.fn();
    const v = new WardrobeView(new I18n('en'), choose);
    document.body.append(v.root);
    v.update(message({ outfit: 'outfit-crimson' }));
    const worn = v.root.querySelector(
      '[data-cosmetic="outfit-crimson"] button',
    ) as HTMLButtonElement;
    expect(worn.textContent).toBe('Worn');
    expect(worn.getAttribute('aria-pressed')).toBe('true');
    const off = [...v.root.querySelectorAll('button')].find((b) => b.textContent === 'Take off');
    off?.click();
    expect(choose).toHaveBeenCalledWith('outfit', null);
  });

  it('passes the structural accessibility check', async () => {
    const v = new WardrobeView(new I18n('en'), () => {});
    document.body.append(v.root);
    v.hidden = false;
    v.update(message());
    const r = await axe.run(v.root, {
      rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
    });
    expect(r.violations.map((x) => x.id)).toEqual([]);
  });
});
