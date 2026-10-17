import type { Action } from '@heist/shared';
import { defaultBindings, type Bindings } from './Bindings';

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
  /** Actions, resolved to keys at the moment of the press (so remapping works at once). */
  private readonly actionHandlers = new Map<Action, (code: string) => void>();
  private readonly actionHolds = new Map<Action, (down: boolean) => void>();
  /** Which action each held key started, so the right one is let go. */
  private readonly heldBy = new Map<string, Action>();

  private readonly holds = new Map<string, (down: boolean) => void>();
  private readonly held = new Set<string>();

  constructor(
    target: EventTarget = window,
    private keys: Bindings = defaultBindings,
  ) {
    target.addEventListener('keydown', this.onKeyDown as EventListener);
    target.addEventListener('keyup', this.onKeyUp as EventListener);
    target.addEventListener('blur', this.releaseAll);
  }

  /** Switches to another set of key choices (the settings panel changed them). */
  setBindings(keys: Bindings): void {
    this.keys = keys;
  }

  /** Runs `handler` on a fresh press of any key the player has for the action. */
  onAction(action: Action, handler: (code: string) => void): this {
    this.actionHandlers.set(action, handler);
    return this;
  }

  /** Like `hold`, for an action: `handler(true)` when its key goes down, `(false)` when let go. */
  holdAction(action: Action, handler: (down: boolean) => void): this {
    this.actionHolds.set(action, handler);
    return this;
  }

  /** Does the action now, as a gamepad button or a touch control does. */
  trigger(action: Action): void {
    this.actionHandlers.get(action)?.('');
  }

  /** Holds or lets go of an action from a gamepad button or a touch control. */
  setHeld(action: Action, down: boolean): void {
    this.actionHolds.get(action)?.(down);
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
    const action = this.heldBy.get(event.code);
    if (action) {
      this.heldBy.delete(event.code);
      this.actionHolds.get(action)?.(false);
    }
  };

  private readonly releaseAll = (): void => {
    for (const code of this.held) this.holds.get(code)?.(false);
    this.held.clear();
    for (const action of this.heldBy.values()) this.actionHolds.get(action)?.(false);
    this.heldBy.clear();
  };

  private actionOn(code: string, table: ReadonlyMap<Action, unknown>): Action | undefined {
    for (const action of table.keys()) if (this.keys.keys(action).includes(code)) return action;
    return undefined;
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat || isTyping(event.target)) return;
    const heldAction = this.actionOn(event.code, this.actionHolds);
    if (heldAction) {
      this.heldBy.set(event.code, heldAction);
      this.actionHolds.get(heldAction)?.(true);
      return;
    }
    const action = this.actionOn(event.code, this.actionHandlers);
    if (action) {
      event.preventDefault();
      this.actionHandlers.get(action)?.(event.code);
      return;
    }
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
