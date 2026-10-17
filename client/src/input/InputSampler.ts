import {
  ACTIONS,
  type Action,
  Button,
  axisToByte,
  quantiseLag,
  quantisePitch,
  quantiseYaw,
  type InputCommand,
} from '@heist/shared';
import { defaultBindings, type Bindings } from './Bindings';
import { isTyping } from './Hotkeys';

const MAX_PITCH = 1.45;
/** Keys the browser acts on by itself. */
const SCROLL_KEYS: ReadonlySet<string> = new Set([
  'Space',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
]);
/** Radians per mouse pixel. */
const DEFAULT_SENSITIVITY = 0.0022;

/**
 * Turns keyboard + mouse into one `InputCommand` per simulation tick.
 * Pattern: Adapter — Why: the game loop only knows `sample()`; DOM events,
 * focus rules and pointer lock stay in here, so tests drive it with plain
 * synthetic events.
 */
export class InputSampler {
  private readonly down = new Set<string>();
  private yaw = 0;
  private pitch = 0;
  private seq = 0;
  private viewLagMs = 0;
  /** While false (pointer not locked) mouse movement does not turn the camera. */
  private looking = false;
  /** Mouse-look speed multiplier: lower while zoomed in, so aim stays steady. */
  private lookScale = 1;
  /** The player's own look speed and direction (settings). */
  private userScale = 1;
  private invertY = false;
  /** Held by something other than a key: a gamepad button, a touch control. */
  private readonly virtualHeld = new Set<Action>();
  /** Analog movement from a stick (−1…1), added to the keys. */
  private stickX = 0;
  private stickY = 0;

  constructor(
    private readonly target: EventTarget = window,
    private readonly sensitivity = DEFAULT_SENSITIVITY,
    private bindings: Bindings = defaultBindings,
  ) {
    target.addEventListener('keydown', this.onKeyDown as EventListener);
    target.addEventListener('keyup', this.onKeyUp as EventListener);
    target.addEventListener('blur', this.releaseAll);
    target.addEventListener('mousemove', this.onMouseMove as EventListener);
  }

  setLooking(looking: boolean): void {
    this.looking = looking;
    if (!looking) this.releaseAll();
  }

  /** The player's chosen look speed (a multiplier) and whether up and down are swapped. */
  setLookPreferences(scale: number, invertY: boolean): void {
    this.userScale = scale;
    this.invertY = invertY;
  }

  /** Switches to another set of key choices (the settings panel changed them). */
  setBindings(bindings: Bindings): void {
    this.bindings = bindings;
  }

  /** An action held or let go by something that is not a key (gamepad, touch). */
  setActionHeld(action: Action, held: boolean): void {
    if (held) this.virtualHeld.add(action);
    else this.virtualHeld.delete(action);
  }

  /** Analog movement, each −1…1 (+x right, +y forward). Zero when the stick is let go. */
  setStick(x: number, y: number): void {
    this.stickX = Math.max(-1, Math.min(1, x));
    this.stickY = Math.max(-1, Math.min(1, y));
  }

  /** Turns the view by an amount (radians), from a stick or a touch drag. Scaled by the player's look speed. */
  look(dYaw: number, dPitch: number): void {
    const scale = this.userScale * this.lookScale;
    this.yaw -= dYaw * scale;
    const up = this.invertY ? -dPitch : dPitch;
    this.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.pitch - up * scale));
  }

  /** Slows (or restores) mouse look, e.g. while a scope zooms the view in. */
  setLookScale(scale: number): void {
    this.lookScale = scale;
  }

  /** Recoil: the view jumps up by `pitch` radians; the player pulls it back down. */
  kick(pitch: number): void {
    this.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.pitch + pitch));
  }

  /** Whether the aim control (right mouse by default) is held. */
  get aiming(): boolean {
    return this.isHeld('aim');
  }

  /** Whether any key of the action, or a virtual control, is held. */
  isHeld(action: Action): boolean {
    return this.virtualHeld.has(action) || this.bindings.keys(action).some((c) => this.down.has(c));
  }

  /** Network delay + interpolation delay as the player sees the world; the server rewinds shots by it. */
  setViewLag(ms: number): void {
    this.viewLagMs = quantiseLag(ms);
  }

  get currentYaw(): number {
    return this.yaw;
  }

  get currentPitch(): number {
    return this.pitch;
  }

  /** Called by prediction code after a respawn so the camera faces where the player does. */
  setLook(yaw: number, pitch = 0): void {
    this.yaw = yaw;
    this.pitch = pitch;
  }

  /** Whether a key (by `KeyboardEvent.code`) is currently held. */
  isDown(code: string): boolean {
    return this.down.has(code);
  }

  sample(): InputCommand {
    const axis = (positive: Action, negative: Action) =>
      (this.isHeld(positive) ? 1 : 0) - (this.isHeld(negative) ? 1 : 0);
    let buttons = 0;
    if (this.isHeld('jump')) buttons |= Button.Jump;
    if (this.isHeld('crouch')) buttons |= Button.Crouch;
    if (this.isHeld('sprint')) buttons |= Button.Sprint;
    if (this.isHeld('fire')) buttons |= Button.Fire;
    if (this.aiming) buttons |= Button.Aim;
    const clamp = (v: number) => Math.max(-1, Math.min(1, v));
    this.seq = (this.seq + 1) & 0xffff;
    return {
      seq: this.seq,
      moveX: axisToByte(clamp(axis('right', 'left') + this.stickX)),
      moveY: axisToByte(clamp(axis('forward', 'back') + this.stickY)),
      // Quantised to the wire resolution up front: prediction and the server then
      // simulate identical numbers (the decoded angle equals what we used here).
      yaw: quantiseYaw(this.yaw),
      pitch: quantisePitch(this.pitch),
      buttons,
      viewLagMs: this.viewLagMs,
    };
  }

  destroy(): void {
    this.target.removeEventListener('keydown', this.onKeyDown as EventListener);
    this.target.removeEventListener('keyup', this.onKeyUp as EventListener);
    this.target.removeEventListener('blur', this.releaseAll);
    this.target.removeEventListener('mousemove', this.onMouseMove as EventListener);
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (isTyping(event.target)) return;
    this.down.add(event.code);
    // Stop a key the page would scroll or move focus with (Space, the arrows) while it is a game key.
    if (
      SCROLL_KEYS.has(event.code) &&
      ACTIONS.some((a) => this.bindings.keys(a).includes(event.code))
    )
      event.preventDefault();
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.down.delete(event.code);
  };

  private readonly releaseAll = (): void => {
    this.down.clear();
  };

  private readonly onMouseMove = (event: MouseEvent): void => {
    if (!this.looking) return;
    const speed = this.sensitivity * this.lookScale * this.userScale;
    const dy = this.invertY ? -event.movementY : event.movementY;
    this.yaw -= event.movementX * speed;
    this.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.pitch - dy * speed));
  };

  /** Mouse buttons come through the same set as keys (`Mouse0` = left, `Mouse2` = right). */
  pressMouse(button: number, pressed: boolean): void {
    const code = `Mouse${button}`;
    if (pressed && this.looking) this.down.add(code);
    else this.down.delete(code);
  }
}
