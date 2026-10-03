import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createResizer, type ResizerOptions } from './Resizer';

let size: number;
let resets: number;

const make = (extra: Partial<ResizerOptions> = {}) =>
  createResizer({
    axis: 'x',
    direction: 1,
    label: 'Test size',
    read: () => size,
    apply: (px) => {
      size = px;
    },
    min: () => 100,
    max: () => 500,
    reset: () => {
      resets++;
    },
    ...extra,
  });

const mouse = (el: HTMLElement, type: string, clientX: number, clientY = 0) =>
  el.dispatchEvent(new MouseEvent(type, { clientX, clientY, bubbles: true, cancelable: true }));

beforeEach(() => {
  size = 300;
  resets = 0;
  localStorage.clear();
});
afterEach(() => localStorage.clear());

describe('createResizer', () => {
  it('is an accessible, focusable separator', () => {
    const el = make();
    expect(el.getAttribute('role')).toBe('separator');
    expect(el.getAttribute('aria-orientation')).toBe('vertical');
    expect(el.tabIndex).toBe(0);
  });

  it('grows with the pointer and clamps to min/max', () => {
    const el = make();
    mouse(el, 'pointerdown', 50);
    mouse(el, 'pointermove', 90);
    expect(size).toBe(340);
    mouse(el, 'pointermove', 900);
    expect(size).toBe(500);
    mouse(el, 'pointermove', -900);
    expect(size).toBe(100);
  });

  it('inverts the drag for handles on the far edge', () => {
    const el = make({ direction: -1 });
    mouse(el, 'pointerdown', 50);
    mouse(el, 'pointermove', 20);
    expect(size).toBe(330);
  });

  it('uses the y coordinate for vertical handles', () => {
    const el = make({ axis: 'y' });
    mouse(el, 'pointerdown', 0, 10);
    mouse(el, 'pointermove', 999, 60);
    expect(size).toBe(350);
  });

  it('ignores moves when no drag started', () => {
    const el = make();
    mouse(el, 'pointermove', 400);
    expect(size).toBe(300);
  });

  it('remembers the size after a drag and restores it next time', () => {
    const el = make({ storageKey: 'test.size' });
    mouse(el, 'pointerdown', 0);
    mouse(el, 'pointerup', 80);
    expect(localStorage.getItem('test.size')).toBe('380');
    size = 0;
    make({ storageKey: 'test.size' });
    expect(size).toBe(380);
  });

  it('resizes from the keyboard and resets on double-click', () => {
    const el = make({ storageKey: 'test.size' });
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(size).toBe(324);
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(size).toBe(276);
    el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(resets).toBe(1);
    expect(localStorage.getItem('test.size')).toBeNull();
  });

  it('does not let Escape-adjacent keys leak but passes unrelated keys through', () => {
    const el = make();
    const arrow = new KeyboardEvent('keydown', {
      key: 'ArrowRight',
      bubbles: true,
      cancelable: true,
    });
    el.dispatchEvent(arrow);
    expect(arrow.defaultPrevented).toBe(true);
    const other = new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true });
    el.dispatchEvent(other);
    expect(other.defaultPrevented).toBe(false);
  });
});
