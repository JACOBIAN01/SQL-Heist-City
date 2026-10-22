import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DuelMessage } from '@heist/shared';
import { I18n } from '../../i18n/I18n';
import { DuelView } from './DuelView';

afterEach(() => document.body.replaceChildren());

const msg = (over: Partial<DuelMessage> = {}): DuelMessage => ({
  t: 'duel',
  state: 'countdown',
  opponent: 'Ben',
  you: 0,
  them: 0,
  draw: 1,
  draws: 5,
  drawId: 0,
  seconds: 3,
  ...over,
});

const make = () => {
  const hooks = { onDraw: vi.fn(), onEnd: vi.fn() };
  const v = new DuelView(new I18n('en'), hooks);
  document.body.append(v.root);
  return { v, hooks };
};

describe('DuelView', () => {
  it('stays hidden until the server says anything, then says what is happening', () => {
    const { v } = make();
    expect(v.root.hidden).toBe(true);
    v.update(msg({ state: 'waiting', opponent: null }));
    expect(v.root.textContent).toContain('Waiting for an opponent');
    v.update(msg());
    expect(v.root.textContent).toContain('You face Ben. Get ready: 3');
    v.update(msg({ state: 'draw', drawId: 1, draw: 2, you: 1, them: 0, seconds: 90 }));
    expect(v.root.textContent).toContain('Draw 2 of 5 · you 1 – 0 Ben · 90 s');
  });

  it('opens the question once for each new draw, and closes it when the draw ends', () => {
    const { v, hooks } = make();
    v.update(msg({ state: 'draw', drawId: 1 }));
    v.update(msg({ state: 'draw', drawId: 1, seconds: 100 })); // the same draw ticking down
    expect(hooks.onDraw).toHaveBeenCalledTimes(1);
    v.update(msg({ state: 'between', drawId: 1, last: 'them', them: 1 }));
    expect(hooks.onEnd).toHaveBeenCalledTimes(1);
    v.update(msg({ state: 'between', drawId: 1, last: 'them', them: 1 }));
    expect(hooks.onEnd).toHaveBeenCalledTimes(1); // only when leaving a draw
    v.update(msg({ state: 'draw', drawId: 2 }));
    expect(hooks.onDraw).toHaveBeenCalledTimes(2);
  });

  it('says who won the draw and the duel', () => {
    const { v } = make();
    v.update(msg({ state: 'between', last: 'you', you: 1 }));
    expect(v.root.textContent).toContain('You were faster!');
    v.update(msg({ state: 'between', last: 'them', them: 1 }));
    expect(v.root.textContent).toContain('Ben was faster.');
    v.update(msg({ state: 'between', last: 'none' }));
    expect(v.root.textContent).toContain('Nobody solved it in time.');
    v.update(msg({ state: 'over', result: 'win', you: 3, them: 1 }));
    expect(v.root.textContent).toContain('You won the duel 3–1!');
    expect(v.root.className).toContain('duel-win');
    v.update(msg({ state: 'over', result: 'lose', you: 1, them: 3 }));
    expect(v.root.textContent).toContain('Ben won the duel 3–1.');
    v.update(msg({ state: 'over', result: 'tie', you: 2, them: 2 }));
    expect(v.root.textContent).toContain('a tie, 2–2');
  });

  it('is announced politely to screen readers', () => {
    const { v } = make();
    expect(v.root.getAttribute('role')).toBe('status');
    expect(v.root.getAttribute('aria-live')).toBe('polite');
  });
});
