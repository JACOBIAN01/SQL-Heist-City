import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Button } from '@heist/shared';
import { InputSampler } from './InputSampler';
import { PointerLock } from './PointerLock';

let canvas: HTMLElement;
let input: InputSampler;
let lock: PointerLock;
const changes: boolean[] = [];

const setLocked = (locked: boolean) => {
  Object.defineProperty(document, 'pointerLockElement', {
    value: locked ? canvas : null,
    configurable: true,
  });
  document.dispatchEvent(new Event('pointerlockchange'));
};

beforeEach(() => {
  changes.length = 0;
  canvas = document.createElement('canvas');
  document.body.append(canvas);
  input = new InputSampler(new EventTarget());
  lock = new PointerLock(canvas, input, (l) => changes.push(l));
});
afterEach(() => {
  lock.destroy();
  input.destroy();
  canvas.remove();
  Object.defineProperty(document, 'pointerLockElement', { value: null, configurable: true });
});

describe('PointerLock', () => {
  it('asks for the pointer on click', () => {
    const request = vi.fn();
    canvas.requestPointerLock = request;
    canvas.click();
    expect(request).toHaveBeenCalledOnce();
  });

  it('turns mouse look on and off with the lock and reports it', () => {
    setLocked(true);
    expect(lock.locked).toBe(true);
    setLocked(false);
    expect(changes).toEqual([true, false]);
  });

  it('left mouse fires only while locked', () => {
    canvas.dispatchEvent(new MouseEvent('mousedown', { button: 0 }));
    expect(input.sample().buttons & Button.Fire).toBeFalsy();
    setLocked(true);
    canvas.dispatchEvent(new MouseEvent('mousedown', { button: 0 }));
    expect(input.sample().buttons & Button.Fire).toBeTruthy();
    window.dispatchEvent(new MouseEvent('mouseup', { button: 0 }));
    expect(input.sample().buttons & Button.Fire).toBeFalsy();
  });
});
