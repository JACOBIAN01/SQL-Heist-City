import { h } from '../dom';

export interface ResizerOptions {
  /** Drag direction that changes the size: horizontal handle moves along x, vertical along y. */
  readonly axis: 'x' | 'y';
  /** +1: dragging right/down grows the thing; -1: dragging right/down shrinks it. */
  readonly direction: 1 | -1;
  readonly label: string;
  /** Current size in px (measured, so it is right even before the user ever dragged). */
  readonly read: () => number;
  readonly apply: (px: number) => void;
  readonly min: () => number;
  readonly max: () => number;
  /** Double-click / Home restores the stylesheet default. */
  readonly reset: () => void;
  /** localStorage key; the last size is re-applied on creation and saved after each drag. */
  readonly storageKey?: string;
}

const KEY_STEP = 24;

/**
 * A drag handle (mouse, touch, pen and keyboard) that resizes one thing. The
 * panel has three of them — width, problem/work split, editor height — so
 * the drag maths lives here once instead of three times.
 */
export function createResizer(options: ResizerOptions): HTMLElement {
  const { axis, direction } = options;
  const clamp = (px: number) => Math.min(options.max(), Math.max(options.min(), px));
  const set = (px: number) => {
    const next = Math.round(clamp(px));
    options.apply(next);
    return next;
  };
  const save = (px: number) => {
    if (options.storageKey === undefined) return;
    try {
      localStorage.setItem(options.storageKey, String(px));
    } catch {
      // Storage can be blocked; the size just won't be remembered.
    }
  };

  const handle = h('div', {
    class: `sqlp-resizer ${axis}`,
    attrs: {
      role: 'separator',
      'aria-orientation': axis === 'x' ? 'vertical' : 'horizontal',
      'aria-label': options.label,
      title: `Drag to resize ${options.label.toLowerCase()} (double-click to reset)`,
      tabindex: '0',
    },
  });

  let drag: { from: number; size: number } | null = null;
  const pos = (event: MouseEvent) => (axis === 'x' ? event.clientX : event.clientY);

  handle.addEventListener('pointerdown', (event) => {
    drag = { from: pos(event), size: options.read() };
    handle.setPointerCapture?.((event as PointerEvent).pointerId);
    handle.classList.add('dragging');
    event.preventDefault();
  });
  handle.addEventListener('pointermove', (event) => {
    if (drag) set(drag.size + direction * (pos(event) - drag.from));
  });
  const end = (event: Event) => {
    if (!drag) return;
    const next = set(drag.size + direction * (pos(event as MouseEvent) - drag.from));
    drag = null;
    handle.classList.remove('dragging');
    save(next);
  };
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', () => {
    drag = null;
    handle.classList.remove('dragging');
  });

  handle.addEventListener('dblclick', () => {
    options.reset();
    if (options.storageKey !== undefined) {
      try {
        localStorage.removeItem(options.storageKey);
      } catch {
        // see save()
      }
    }
  });
  handle.addEventListener('keydown', (event) => {
    const grow = axis === 'x' ? 'ArrowRight' : 'ArrowDown';
    const shrink = axis === 'x' ? 'ArrowLeft' : 'ArrowUp';
    if (event.key === 'Home') {
      options.reset();
    } else if (event.key === grow || event.key === shrink) {
      const sign = (event.key === grow ? 1 : -1) * direction;
      save(set(options.read() + sign * KEY_STEP));
    } else {
      return;
    }
    // Keep Esc/arrows from reaching the game or the panel's Esc handler.
    event.preventDefault();
    event.stopPropagation();
  });

  if (options.storageKey !== undefined) {
    try {
      const stored = Number(localStorage.getItem(options.storageKey));
      if (Number.isFinite(stored) && stored > 0) options.apply(stored);
    } catch {
      // see save()
    }
  }
  return handle;
}
