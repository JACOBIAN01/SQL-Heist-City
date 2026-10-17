import { describe, expect, it, vi } from 'vitest';
import { Hotkeys } from './Hotkeys';

const press = (target: EventTarget, code: string, init: KeyboardEventInit = {}) =>
  target.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true, ...init }));

describe('Hotkeys', () => {
  it('runs the handler with the key code on a fresh press', () => {
    const target = new EventTarget();
    const handler = vi.fn();
    new Hotkeys(target).bind(['KeyF', 'Digit1'], handler);
    press(target, 'KeyF');
    press(target, 'Digit1');
    press(target, 'KeyG');
    expect(handler.mock.calls).toEqual([['KeyF'], ['Digit1']]);
  });

  it('ignores key repeat', () => {
    const target = new EventTarget();
    const handler = vi.fn();
    new Hotkeys(target).bind(['KeyF'], handler);
    press(target, 'KeyF', { repeat: true });
    expect(handler).not.toHaveBeenCalled();
  });

  it('ignores presses while typing in the SQL editor or a field', () => {
    const handler = vi.fn();
    new Hotkeys(document).bind(['KeyF'], handler);
    const editor = document.createElement('div');
    editor.className = 'cm-editor';
    const inner = document.createElement('div');
    editor.append(inner);
    const input = document.createElement('input');
    document.body.append(editor, input);
    press(inner, 'KeyF');
    press(input, 'KeyF');
    expect(handler).not.toHaveBeenCalled();
    press(document.body, 'KeyF');
    expect(handler).toHaveBeenCalledTimes(1);
    editor.remove();
    input.remove();
  });

  it('stops the browser acting on a key it handles (Tab moving focus)', () => {
    const target = new EventTarget();
    new Hotkeys(target).bind(['Tab'], () => {});
    const handled = new KeyboardEvent('keydown', { code: 'Tab', cancelable: true });
    target.dispatchEvent(handled);
    expect(handled.defaultPrevented).toBe(true);
    const other = new KeyboardEvent('keydown', { code: 'KeyZ', cancelable: true });
    target.dispatchEvent(other);
    expect(other.defaultPrevented).toBe(false);
  });

  it('reports a held key going down and up, and lets go when the window loses focus', () => {
    const target = new EventTarget();
    const states: boolean[] = [];
    new Hotkeys(target).hold('KeyB', (down) => states.push(down));
    press(target, 'KeyB');
    press(target, 'KeyB', { repeat: true });
    target.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyB' }));
    target.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyB' })); // a stray second keyup
    expect(states).toEqual([true, false]);
    press(target, 'KeyB');
    target.dispatchEvent(new Event('blur'));
    expect(states).toEqual([true, false, true, false]);
  });
});

describe('Hotkeys by action (22.2)', () => {
  const press = (target: EventTarget, code: string, type = 'keydown') =>
    target.dispatchEvent(
      Object.assign(new Event(type, { cancelable: true }), { code, repeat: false }),
    );

  it('follows the keys the player has chosen, at the moment of the press', () => {
    const target = new EventTarget();
    let keys: readonly string[] = ['KeyF'];
    const hotkeys = new Hotkeys(target, { keys: () => keys });
    const used = vi.fn();
    hotkeys.onAction('use', used);
    press(target, 'KeyF');
    expect(used).toHaveBeenCalledTimes(1);
    keys = ['KeyE']; // remapped while playing
    press(target, 'KeyF');
    expect(used).toHaveBeenCalledTimes(1);
    press(target, 'KeyE');
    expect(used).toHaveBeenCalledTimes(2);
  });

  it('holds an action while its key is down and lets go of the right one', () => {
    const target = new EventTarget();
    let keys: readonly string[] = ['KeyB'];
    const hotkeys = new Hotkeys(target, { keys: () => keys });
    const states: boolean[] = [];
    hotkeys.holdAction('scoreboard', (d) => states.push(d));
    press(target, 'KeyB');
    keys = ['KeyG']; // remapped in the middle of a hold
    press(target, 'KeyB', 'keyup');
    expect(states).toEqual([true, false]);
  });

  it('lets a gamepad or touch control do the same things', () => {
    const hotkeys = new Hotkeys(new EventTarget());
    const used = vi.fn();
    const states: boolean[] = [];
    hotkeys.onAction('use', used).holdAction('scoreboard', (d) => states.push(d));
    hotkeys.trigger('use');
    hotkeys.setHeld('scoreboard', true);
    hotkeys.setHeld('scoreboard', false);
    expect(used).toHaveBeenCalledTimes(1);
    expect(states).toEqual([true, false]);
  });
});
