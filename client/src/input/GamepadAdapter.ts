import type { Action, PlayerSettings } from '@heist/shared';

/** The parts of a browser Gamepad this reads (so tests need no browser). */
export interface PadState {
  readonly axes: readonly number[];
  readonly buttons: readonly { readonly pressed: boolean; readonly value?: number }[];
}

/** What the adapter drives: the same action-level calls the keyboard ends up making. */
export interface PadTarget {
  setStick(x: number, y: number): void;
  look(dYaw: number, dPitch: number): void;
  setActionHeld(action: Action, held: boolean): void;
}
export interface PadActions {
  trigger(action: Action): void;
  setHeld(action: Action, down: boolean): void;
}

/** Standard-mapping button numbers. */
const HOLD: Readonly<Record<number, Action>> = {
  0: 'jump',
  1: 'crouch',
  6: 'aim',
  7: 'fire',
  10: 'sprint',
};
const PULSE: Readonly<Record<number, Action>> = { 2: 'use', 3: 'tasks', 9: 'settings', 13: 'map' };
const SCOREBOARD = 8;
const PREV_GUN = 14;
const NEXT_GUN = 15;

/** Full-deflection look speed (radians per second) before the player's own sensitivity. */
const LOOK_RATE = 3.2;

/** Applies the dead zone to a stick as a circle (not per axis), and rescales so it starts from 0. */
export function shapeStick(x: number, y: number, deadzone: number): [number, number] {
  const m = Math.hypot(x, y);
  if (m <= deadzone) return [0, 0];
  const scaled = Math.min(1, (m - deadzone) / (1 - deadzone));
  return [(x / m) * scaled, (y / m) * scaled];
}

/**
 * Plays with a controller (Phase 22.4): left stick walks, right stick looks, triggers and buttons
 * do what their keys do. Buttons arrive as actions, so everything a remapped key can do, a pad can.
 *
 * Pattern: Adapter — Why: the game takes actions and a stick; the Gamepad API is polled arrays of
 * numbers. This is the only place that knows both.
 */
export class GamepadAdapter {
  private down = new Set<number>();

  constructor(
    private readonly read: () => readonly (PadState | null)[],
    private readonly target: PadTarget,
    private readonly actions: PadActions,
    private readonly settings: () => PlayerSettings['gamepad'],
    private readonly cycleGun: (step: 1 | -1) => void,
  ) {}

  /** Call once a frame. */
  update(dtSeconds: number): void {
    const pad = this.read().find((p): p is PadState => p !== null);
    if (!pad) return this.release();
    const { deadzone, sensitivity } = this.settings();
    const [mx, my] = shapeStick(pad.axes[0] ?? 0, pad.axes[1] ?? 0, deadzone);
    this.target.setStick(mx, -my);
    const [lx, ly] = shapeStick(pad.axes[2] ?? 0, pad.axes[3] ?? 0, deadzone);
    // Squared, so small pushes make fine adjustments and a full push turns quickly.
    const rate = LOOK_RATE * sensitivity * dtSeconds;
    this.target.look(Math.sign(lx) * lx * lx * rate, Math.sign(ly) * ly * ly * rate);

    const now = new Set<number>();
    pad.buttons.forEach((b, i) => b.pressed && now.add(i));
    for (const [n, action] of Object.entries(HOLD))
      this.target.setActionHeld(action, now.has(Number(n)));
    const edge = (n: number) => now.has(n) && !this.down.has(n);
    for (const [n, action] of Object.entries(PULSE))
      if (edge(Number(n))) this.actions.trigger(action);
    if (edge(PREV_GUN)) this.cycleGun(-1);
    if (edge(NEXT_GUN)) this.cycleGun(1);
    if (now.has(SCOREBOARD) !== this.down.has(SCOREBOARD))
      this.actions.setHeld('scoreboard', now.has(SCOREBOARD));
    this.down = now;
  }

  /** The pad went away (or none is connected): let go of everything it held. */
  private release(): void {
    if (this.down.size === 0) return;
    this.target.setStick(0, 0);
    for (const action of Object.values(HOLD)) this.target.setActionHeld(action, false);
    if (this.down.has(SCOREBOARD)) this.actions.setHeld('scoreboard', false);
    this.down = new Set();
  }
}
