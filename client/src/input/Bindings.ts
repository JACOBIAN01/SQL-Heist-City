import { DEFAULT_KEYS, keysFor, type Action, type PlayerSettings } from '@heist/shared';

/**
 * Which keys do which action, now (Phase 22.2). The sampler and the hotkeys ask this on every
 * press, so a change in the settings panel works at once with no restart.
 * Pattern: Adapter — Why: the game thinks in actions ("jump"); keyboards and mice speak in codes.
 */
export interface Bindings {
  keys(action: Action): readonly string[];
}

/** The default keys, for tests and for play before the settings load. */
export const defaultBindings: Bindings = { keys: (action) => DEFAULT_KEYS[action] };

/** Bindings read from the player's settings as they stand at the moment of asking. */
export const bindingsFrom = (current: () => PlayerSettings): Bindings => ({
  keys: (action) => keysFor(current(), action),
});

/** The action a key code is bound to, or undefined. Several actions on one key return the first. */
export function actionFor(
  bindings: Bindings,
  actions: readonly Action[],
  code: string,
): Action | undefined {
  return actions.find((a) => bindings.keys(a).includes(code));
}
