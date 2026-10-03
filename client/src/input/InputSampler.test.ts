import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Button } from '@heist/shared';
import { InputSampler } from './InputSampler';

let target: EventTarget;
let input: InputSampler;

const key = (type: 'keydown' | 'keyup', code: string, on: EventTarget = target) =>
  on.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true, cancelable: true }));
const move = (movementX: number, movementY: number) => {
  const event = new MouseEvent('mousemove');
  Object.defineProperty(event, 'movementX', { value: movementX });
  Object.defineProperty(event, 'movementY', { value: movementY });
  target.dispatchEvent(event);
};

beforeEach(() => {
  target = new EventTarget();
  input = new InputSampler(target, 0.01);
});
afterEach(() => input.destroy());

describe('InputSampler', () => {
  it('maps WASD to move axes', () => {
    key('keydown', 'KeyW');
    key('keydown', 'KeyD');
    const c = input.sample();
    expect(c.moveY).toBe(127);
    expect(c.moveX).toBe(127);
    key('keyup', 'KeyW');
    key('keydown', 'KeyS');
    expect(input.sample().moveY).toBe(-127);
  });

  it('cancels opposite keys', () => {
    key('keydown', 'KeyA');
    key('keydown', 'KeyD');
    expect(input.sample().moveX).toBe(0);
  });

  it('maps Space, Ctrl and Shift to buttons', () => {
    key('keydown', 'Space');
    key('keydown', 'ShiftLeft');
    key('keydown', 'ControlLeft');
    const { buttons } = input.sample();
    expect(buttons & Button.Jump).toBeTruthy();
    expect(buttons & Button.Sprint).toBeTruthy();
    expect(buttons & Button.Crouch).toBeTruthy();
    expect(buttons & Button.Fire).toBeFalsy();
  });

  it('numbers commands consecutively and wraps at 16 bits', () => {
    const first = input.sample().seq;
    expect(input.sample().seq).toBe(first + 1);
    for (let i = 0; i < 65536; i++) input.sample();
    expect(input.sample().seq).toBeLessThan(0x10000);
  });

  it('ignores mouse movement until the pointer is locked, then turns the view', () => {
    move(50, 0);
    expect(input.currentYaw).toBe(0);
    input.setLooking(true);
    move(50, 0);
    expect(input.currentYaw).toBeCloseTo(-0.5);
    move(0, -30);
    expect(input.currentPitch).toBeCloseTo(0.3);
  });

  it('clamps pitch so the camera cannot flip over', () => {
    input.setLooking(true);
    move(0, -100000);
    expect(input.currentPitch).toBeLessThan(Math.PI / 2);
  });

  it('does not steal keys typed into the SQL editor or a field', () => {
    const editor = document.createElement('div');
    editor.className = 'cm-editor';
    const field = document.createElement('input');
    editor.append(field);
    document.body.append(editor);
    const doc = new InputSampler(document, 0.01);
    key('keydown', 'KeyW', field);
    expect(doc.sample().moveY).toBe(0);
    doc.destroy();
    editor.remove();
  });

  it('releases everything when the pointer lock is lost', () => {
    input.setLooking(true);
    key('keydown', 'KeyW');
    input.setLooking(false);
    expect(input.sample().moveY).toBe(0);
  });

  it('only fires while the pointer is locked', () => {
    input.pressMouse(0, true);
    expect(input.sample().buttons & Button.Fire).toBeFalsy();
    input.setLooking(true);
    input.pressMouse(0, true);
    expect(input.sample().buttons & Button.Fire).toBeTruthy();
    input.pressMouse(0, false);
    expect(input.sample().buttons & Button.Fire).toBeFalsy();
  });
});
