/** True while the player is typing (SQL editor, form fields): keys then belong to the page. */
export function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof Element && target.closest('input, textarea, select, .cm-editor') !== null
  );
}

/**
 * One-shot key presses for actions (F to use, 1–5 to hold a gun), kept out of
 * movement sampling. Presses while typing or held down (key repeat) are ignored.
 */
export class Hotkeys {
  private readonly bindings = new Map<string, (code: string) => void>();

  constructor(target: EventTarget = window) {
    target.addEventListener('keydown', this.onKeyDown as EventListener);
  }

  /** Runs `handler(code)` on a fresh press of any of the keys (`KeyboardEvent.code`). */
  bind(codes: readonly string[], handler: (code: string) => void): this {
    for (const code of codes) this.bindings.set(code, handler);
    return this;
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat || isTyping(event.target)) return;
    this.bindings.get(event.code)?.(event.code);
  };
}
