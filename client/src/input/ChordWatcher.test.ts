import { describe, expect, it, vi } from 'vitest';
import { ChordWatcher } from './ChordWatcher';

describe('ChordWatcher', () => {
  it('fires once when all the keys are held, in any order', () => {
    const fire = vi.fn();
    const c = new ChordWatcher(['ControlLeft', 'ShiftLeft', 'KeyK'], fire);
    expect(c.down('KeyK')).toBe(false);
    expect(c.down('ControlLeft')).toBe(false);
    expect(c.down('ShiftLeft')).toBe(true);
    expect(c.down('ShiftLeft')).toBe(false); // key repeat
    expect(fire).toHaveBeenCalledTimes(1);
  });
  it('fires again only after a key of the chord was let go', () => {
    const fire = vi.fn();
    const c = new ChordWatcher(['KeyA', 'KeyB'], fire);
    c.down('KeyA');
    c.down('KeyB');
    c.up('KeyB');
    c.down('KeyB');
    expect(fire).toHaveBeenCalledTimes(2);
  });
  it('does not fire for part of the chord, or when the window loses focus mid-way', () => {
    const fire = vi.fn();
    const c = new ChordWatcher(['KeyA', 'KeyB'], fire);
    c.down('KeyA');
    c.reset();
    c.down('KeyB');
    expect(fire).not.toHaveBeenCalled();
  });
  it('follows a new combination, and an empty one never fires', () => {
    const fire = vi.fn();
    const c = new ChordWatcher(['KeyA', 'KeyB'], fire);
    c.setCombo(['KeyX', 'KeyY']);
    c.down('KeyA');
    c.down('KeyB');
    expect(fire).not.toHaveBeenCalled();
    c.setCombo([]);
    c.down('KeyX');
    expect(fire).not.toHaveBeenCalled();
  });
  it('listens on a window and stops the browser acting on the chord', () => {
    const fire = vi.fn();
    const c = new ChordWatcher(['KeyA', 'KeyB'], fire);
    const stop = c.attach(window);
    const press = (code: string) => {
      const e = new KeyboardEvent('keydown', { code, cancelable: true });
      window.dispatchEvent(e);
      return e.defaultPrevented;
    };
    expect(press('KeyA')).toBe(false);
    expect(press('KeyB')).toBe(true);
    expect(fire).toHaveBeenCalledTimes(1);
    stop();
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyB' }));
    press('KeyB');
    expect(fire).toHaveBeenCalledTimes(1);
  });
});
