import {
  Button,
  axisToByte,
  quantiseLag,
  quantisePitch,
  quantiseYaw,
  type InputCommand,
} from '@heist/shared';
import { isTyping } from './Hotkeys';

const MAX_PITCH = 1.45;
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

  constructor(
    private readonly target: EventTarget = window,
    private readonly sensitivity = DEFAULT_SENSITIVITY,
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

  /** Slows (or restores) mouse look, e.g. while a scope zooms the view in. */
  setLookScale(scale: number): void {
    this.lookScale = scale;
  }

  /** Recoil: the view jumps up by `pitch` radians; the player pulls it back down. */
  kick(pitch: number): void {
    this.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.pitch + pitch));
  }

  /** Whether the aim button (right mouse) is held. */
  get aiming(): boolean {
    return this.down.has('Mouse2');
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
    const axis = (positive: string[], negative: string[]) =>
      (positive.some((c) => this.down.has(c)) ? 1 : 0) -
      (negative.some((c) => this.down.has(c)) ? 1 : 0);
    const held = (...codes: string[]) => codes.some((c) => this.down.has(c));
    let buttons = 0;
    if (held('Space')) buttons |= Button.Jump;
    if (held('ControlLeft', 'KeyC')) buttons |= Button.Crouch;
    if (held('ShiftLeft', 'ShiftRight')) buttons |= Button.Sprint;
    if (this.down.has('Mouse0') || held('KeyK')) buttons |= Button.Fire;
    if (this.aiming) buttons |= Button.Aim;
    this.seq = (this.seq + 1) & 0xffff;
    return {
      seq: this.seq,
      moveX: axisToByte(axis(['KeyD'], ['KeyA'])),
      moveY: axisToByte(axis(['KeyW'], ['KeyS'])),
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
    // Stop Space scrolling and Ctrl combos reaching the browser while playing.
    if (event.code === 'Space') event.preventDefault();
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.down.delete(event.code);
  };

  private readonly releaseAll = (): void => {
    this.down.clear();
  };

  private readonly onMouseMove = (event: MouseEvent): void => {
    if (!this.looking) return;
    const speed = this.sensitivity * this.lookScale;
    this.yaw -= event.movementX * speed;
    this.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.pitch - event.movementY * speed));
  };

  /** Mouse buttons come through the same set as keys (`Mouse0` = left, `Mouse2` = right). */
  pressMouse(button: number, pressed: boolean): void {
    const code = `Mouse${button}`;
    if (pressed && this.looking) this.down.add(code);
    else this.down.delete(code);
  }
}
