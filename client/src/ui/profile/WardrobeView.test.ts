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

  it('shows the season track, with what each step gives and how far the student has got', () => {
    const v = new WardrobeView(new I18n('en'), () => {});
    document.body.append(v.root);
    v.update(message());
    v.updateSeason({
      t: 'season',
      season: {
        id: 'autumn-heist',
        name: 'Autumn Heist',
        theme: 'autumn',
        start: '2026-09-22',
        end: '2026-12-21',
        daysLeft: 12,
        active: true,
        xp: 150,
        level: 1,
        track: [
          {
            level: 1,
            xp: 100,
            cosmetic: 'outfit-autumn',
            cosmeticName: 'Autumn jacket',
            unlocked: true,
          },
          {
            level: 2,
            xp: 300,
            cosmetic: 'mask-pumpkin',
            cosmeticName: 'Pumpkin mask',
            unlocked: false,
          },
        ],
      },
    });
    const section = v.root.querySelector('[data-role="season"]') as HTMLElement;
    expect(section.textContent).toContain('Autumn Heist');
    expect(section.textContent).toContain('Step 1 of 2 · 150 season XP · 12 days left');
    const steps = [...section.querySelectorAll('li')].map((li) => li.getAttribute('data-unlocked'));
    expect(steps).toEqual(['true', 'false']);
    expect(section.textContent).toContain('300 XP: Pumpkin mask');
    expect(v.root.querySelector('[data-cosmetic="mask-pumpkin"]')?.textContent).toContain(
      'Earn 300 season XP (Autumn Heist)',
    );
    // Between seasons the section goes.
    v.updateSeason({ t: 'season' });
    expect(v.root.querySelector('[data-role="season"]')).toBeNull();
  });
});
