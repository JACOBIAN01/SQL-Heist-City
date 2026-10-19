import axe from 'axe-core';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_PROGRESSION_SETTINGS, progressView } from '@heist/shared';
import { RankView } from './RankView';

afterEach(() => document.body.replaceChildren());
const message = (learning: number, play = 0, gained?: number) => ({
  t: 'progress' as const,
  progress: progressView(learning, play, DEFAULT_PROGRESSION_SETTINGS),
  ...(gained ? { gained: { amount: gained, why: 'solve' as const } } : {}),
});

describe('RankView', () => {
  it('is hidden until the server says who the student is, then shows rank and bar', () => {
    const v = new RankView(document.body);
    expect(v.root.hidden).toBe(true);
    v.update(message(250));
    expect(v.root.hidden).toBe(false);
    expect(v.root.textContent).toContain('Lookout · 250 XP');
    const bar = v.root.querySelector('[role="progressbar"]') as HTMLElement;
    // Lookout runs from 100 to 300 XP, so 250 is 150 into a step of 200.
    expect(bar.getAttribute('aria-valuenow')).toBe('150');
    expect(bar.getAttribute('aria-valuemax')).toBe('200');
  });

  it('flashes what was just earned and passes the accessibility check', async () => {
    const v = new RankView(document.body);
    v.update(message(120, 0, 45));
    expect(v.root.textContent).toContain('+45 XP');
    const result = await axe.run(v.root, {
      rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
    });
    expect(result.violations).toEqual([]);
  });

  it('shows a full bar at the top rank', () => {
    const v = new RankView(document.body);
    v.update(message(99999));
    expect(v.root.textContent).toContain('top rank');
    expect((v.root.querySelector('.hud-rank-fill') as HTMLElement).style.width).toBe('100%');
  });
});
