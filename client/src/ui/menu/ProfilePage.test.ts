import axe from 'axe-core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_PROGRESSION_SETTINGS as S,
  progressView,
  skillTree,
  wardrobe,
  type PlayerProfilePage,
} from '@heist/shared';
import { I18n } from '../../i18n/I18n';
import { ProfilePage } from './ProfilePage';

afterEach(() => document.body.replaceChildren());

function page(over: Partial<PlayerProfilePage> = {}): PlayerProfilePage {
  const progress = progressView(250, 100, S);
  const skills = skillTree(new Map([['select', { earned: 9, available: 10, items: 4 }]]), S);
  const items = wardrobe(progress, skills, S);
  return {
    name: 'Ana Silva',
    progress,
    skills,
    mastery: { rcsbe: [], bloom: [] },
    streakDays: 3,
    wardrobe: { items, choice: { outfit: 'outfit-crimson' } },
    history: [
      {
        classId: 1,
        round: 4,
        endedAt: '2026-10-21T10:00:00Z',
        rank: 2,
        players: 24,
        banked: 7000,
        kills: 3,
      },
    ],
    ...over,
  };
}

describe('ProfilePage', () => {
  it('shows rank, mastered topics, round history and what is worn, from the records', async () => {
    const p = new ProfilePage({ loadProfile: async () => page() }, new I18n('en'));
    await p.open();
    const text = p.root.textContent ?? '';
    expect(text).toContain('Ana Silva');
    expect(text).toContain('Runner · 350 XP');
    expect(text).toContain('350 XP to Cracker'); // Runner starts at 300; Cracker is 700
    expect(text).toContain('250 from learning · 100 from playing');
    expect(text).toContain('Day streak: 3');
    expect(text).toContain('1 of 17 topics mastered');
    expect(p.root.querySelector('.profile-mastered')?.textContent).toBe('Selecting');
    expect(text).toContain('Round 4 · #2 of 24 · $7,000 banked · 3 kills');
    expect(text).toContain('Wearing: Crimson jacket');
    const bar = p.root.querySelector('[role="progressbar"]') as HTMLElement;
    expect(bar.getAttribute('aria-valuenow')).toBe('50');
  });

  it('says so while loading, and when the profile cannot be loaded', async () => {
    let release: (v: PlayerProfilePage | undefined) => void = () => {};
    const p = new ProfilePage(
      { loadProfile: () => new Promise((r) => (release = r)) },
      new I18n('en'),
    );
    const opening = p.open();
    expect(p.root.textContent).toContain('Loading your profile');
    release(undefined);
    await opening;
    expect(p.root.textContent).toContain('could not be loaded');
  });

  it('copes with a new student: nothing mastered, no rounds, nothing worn', async () => {
    const empty = page({
      history: [],
      streakDays: 0,
      wardrobe: { items: [], choice: {} },
      skills: skillTree(new Map(), S),
    });
    const p = new ProfilePage({ loadProfile: async () => empty }, new I18n('en'));
    await p.open();
    expect(p.root.textContent).toContain('Nothing mastered yet');
    expect(p.root.textContent).toContain('No class rounds yet.');
    expect(p.root.textContent).toContain('Nothing special worn.');
  });

  it('closes, and passes the structural accessibility check', async () => {
    const p = new ProfilePage({ loadProfile: async () => page() }, new I18n('en'));
    await p.open();
    const r = await axe.run(p.root, {
      rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
    });
    expect(r.violations.map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 80)}`)).toEqual([]);
    p.close();
    expect(p.isOpen).toBe(false);
  });
});
