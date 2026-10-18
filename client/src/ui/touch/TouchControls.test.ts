import axe from 'axe-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PLAYER_SETTINGS, type PlayerSettings } from '@heist/shared';
import { I18n } from '../../i18n/I18n';
import { TouchControls, wantsTouchControls } from './TouchControls';

function setup(touch: Partial<PlayerSettings['touch']> = {}) {
  const target = { setStick: vi.fn(), look: vi.fn(), setActionHeld: vi.fn() };
  const actions = { trigger: vi.fn(), setHeld: vi.fn() };
  const settings = {
    ...DEFAULT_PLAYER_SETTINGS,
    touch: { ...DEFAULT_PLAYER_SETTINGS.touch, ...touch },
  };
  const c = new TouchControls(document.body, target, actions, () => settings, new I18n('en'));
  return { c, target, actions };
}
const fire = (el: Element, type: string, x = 0, y = 0, id = 1) =>
  el.dispatchEvent(
    Object.assign(new Event(type, { bubbles: true, cancelable: true }), {
      pointerId: id,
      clientX: x,
      clientY: y,
    }),
  );

afterEach(() => document.body.replaceChildren());

describe('TouchControls', () => {
  it('shows on a touch device by default, always or never by choice', () => {
    expect(wantsTouchControls('auto', true)).toBe(true);
    expect(wantsTouchControls('auto', false)).toBe(false);
    expect(wantsTouchControls('on', false)).toBe(true);
    expect(wantsTouchControls('off', true)).toBe(false);
    const { c } = setup({ controls: 'on', leftHanded: true });
    c.refresh();
    expect(c.root.hidden).toBe(false);
    expect(c.root.classList.contains('touch-left-handed')).toBe(true);
  });

  it('walks with the stick, up the screen being forward, and stops when let go', () => {
    const { c, target } = setup();
    const stick = c.root.querySelector('[data-role="touch-stick"]') as HTMLElement;
    fire(stick, 'pointerdown', 100, 100);
    fire(stick, 'pointermove', 100, 40);
    const [x, y] = target.setStick.mock.lastCall as [number, number];
    expect(x).toBeCloseTo(0);
    expect(y).toBeGreaterThan(0.9);
    fire(stick, 'pointerup', 100, 40);
    expect(target.setStick).toHaveBeenLastCalledWith(0, 0);
  });

  it('turns the view by dragging', () => {
    const { c, target } = setup();
    const area = c.root.querySelector('[data-role="touch-look"]') as HTMLElement;
    fire(area, 'pointerdown', 10, 10, 2);
    fire(area, 'pointermove', 60, 10, 2);
    const [yaw] = target.look.mock.lastCall as [number, number];
    expect(yaw).toBeGreaterThan(0);
  });

  it('holds fire while touched and does "use" once per tap', () => {
    const { c, target, actions } = setup();
    const fireBtn = c.root.querySelector('.touch-fire') as HTMLElement;
    fire(fireBtn, 'pointerdown');
    expect(target.setActionHeld).toHaveBeenLastCalledWith('fire', true);
    fire(fireBtn, 'pointerup');
    expect(target.setActionHeld).toHaveBeenLastCalledWith('fire', false);
    fire(c.root.querySelector('.touch-use') as HTMLElement, 'pointerdown');
    expect(actions.trigger).toHaveBeenCalledWith('use');
  });

  it('names every button for screen readers (axe)', async () => {
    const { c } = setup({ controls: 'on' });
    c.refresh();
    const result = await axe.run(c.root, { rules: { 'color-contrast': { enabled: false } } });
    expect(result.violations.map((v) => v.id)).toEqual([]);
  });
});
