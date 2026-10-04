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

  private readonly holds = new Map<string, (down: boolean) => void>();
  private readonly held = new Set<string>();

  constructor(target: EventTarget = window) {
    target.addEventListener('keydown', this.onKeyDown as EventListener);
    target.addEventListener('keyup', this.onKeyUp as EventListener);
    target.addEventListener('blur', this.releaseAll);
  }

  /** Calls `handler(true)` when the key goes down and `handler(false)` when it is let go (a scoreboard held open). */
  hold(code: string, handler: (down: boolean) => void): this {
    this.holds.set(code, handler);
    return this;
  }

  /** Runs `handler(code)` on a fresh press of any of the keys (`KeyboardEvent.code`). */
  bind(codes: readonly string[], handler: (code: string) => void): this {
    for (const code of codes) this.bindings.set(code, handler);
    return this;
  }

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    if (this.held.delete(event.code)) this.holds.get(event.code)?.(false);
  };

  private readonly releaseAll = (): void => {
    for (const code of this.held) this.holds.get(code)?.(false);
    this.held.clear();
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat || isTyping(event.target)) return;
    const hold = this.holds.get(event.code);
    if (hold) {
      this.held.add(event.code);
      hold(true);
      return;
    }
    const handler = this.bindings.get(event.code);
    if (!handler) return;
    event.preventDefault(); // Tab must not move browser focus; the digits must not scroll
    handler(event.code);
  };
}
