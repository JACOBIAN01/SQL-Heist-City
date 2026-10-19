import axe from 'axe-core';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_PROGRESSION_SETTINGS, skillTree } from '@heist/shared';
import { I18n } from '../../i18n/I18n';
import { SkillTreeView } from './SkillTreeView';

afterEach(() => document.body.replaceChildren());
const views = skillTree(
  new Map([['select', { earned: 9, available: 10, items: 4 }]]),
  DEFAULT_PROGRESSION_SETTINGS,
);

describe('SkillTreeView', () => {
  it('shows each topic as locked, open or mastered, in words, with what a locked one needs', () => {
    const v = new SkillTreeView(new I18n('en'));
    document.body.append(v.root);
    v.hidden = false;
    v.update(views);
    const state = (id: string) =>
      v.root.querySelector(`[data-skill="${id}"]`)?.getAttribute('data-state');
    expect(state('select')).toBe('mastered');
    expect(state('filter')).toBe('open');
    expect(state('joins')).toBe('locked');
    expect(v.root.querySelector('[data-skill="select"]')?.textContent).toContain('Mastered');
    expect(v.root.querySelector('[data-skill="select"]')?.textContent).toContain('90% of marks');
    expect(v.root.querySelector('[data-skill="joins"]')?.textContent).toContain(
      'Needs: Filtering, Sorting and paging',
    );
    expect(v.root.querySelector('[data-skill="filter"]')?.textContent).toContain('Not tried yet');
  });

  it('draws parents above children and redraws in the language picked', () => {
    const i18n = new I18n('en');
    const v = new SkillTreeView(i18n);
    document.body.append(v.root);
    v.update(views);
    const rows = [...v.root.querySelectorAll('.skills-row')];
    const rowOf = (id: string) => rows.findIndex((r) => r.querySelector(`[data-skill="${id}"]`));
    expect(rowOf('select')).toBeLessThan(rowOf('filter'));
    expect(rowOf('filter')).toBeLessThan(rowOf('joins'));
    i18n.setLocale('hi');
    expect(v.root.querySelector('h2')?.textContent).toBe('Skill tree'); // falls back to English until translated
  });

  it('passes the structural accessibility check', async () => {
    const v = new SkillTreeView(new I18n('en'));
    document.body.append(v.root);
    v.hidden = false;
    v.update(views);
    const r = await axe.run(v.root, {
      rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
    });
    expect(r.violations.map((x) => x.id)).toEqual([]);
  });
});
