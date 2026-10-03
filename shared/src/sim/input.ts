/**
 * One tick of player input, as sent to the server and replayed by the client
 * for prediction. Pattern: Command — Why: a plain value with a sequence number
 * can be validated, queued, rate-limited and replayed after a correction.
 */
export interface InputCommand {
  /** Wraps at 65536; the server echoes the last one it applied. */
  readonly seq: number;
  /** Strafe: −127 (left) … 127 (right). */
  readonly moveX: number;
  /** Forward/back: −127 (back) … 127 (forward). */
  readonly moveY: number;
  /** Radians, 0 faces −z, counter-clockwise positive. */
  readonly yaw: number;
  /** Radians, positive looks up. */
  readonly pitch: number;
  readonly buttons: number;
  /**
   * How far behind the server's present the shooter's screen was (network
   * delay + interpolation), ms. The server rewinds targets by this (capped) when
   * resolving a shot — lag compensation. Sent in 5 ms steps.
   */
  readonly viewLagMs: number;
}

export const Button = {
  Jump: 1,
  Crouch: 2,
  Sprint: 4,
  Fire: 8,
} as const;

export const hasButton = (buttons: number, button: number): boolean => (buttons & button) !== 0;

/** Inputs are sampled and simulated at this fixed rate on client and server. */
export const SIM_HZ = 60;
export const SIM_DT = 1 / SIM_HZ;

/** Float axis in [−1, 1] → the wire's signed byte. */
export const axisToByte = (value: number): number =>
  Math.max(-127, Math.min(127, Math.round(value * 127)));

/** Sequence numbers wrap; `a` is newer than `b` when the signed 16-bit gap is positive. */
export const seqNewer = (a: number, b: number): boolean =>
  ((a - b + 0x10000) & 0xffff) < 0x8000 && a !== b;

/** Wire resolution for angles. Both sides simulate with the *quantised* values so they cannot disagree. */
const TAU = Math.PI * 2;
const HALF_PI = Math.PI / 2;

export const yawToWire = (yaw: number): number =>
  Math.round(((((yaw % TAU) + TAU) % TAU) / TAU) * 65536) & 0xffff;
export const yawFromWire = (wire: number): number => (wire / 65536) * TAU;
export const quantiseYaw = (yaw: number): number => yawFromWire(yawToWire(yaw));

export const pitchToWire = (pitch: number): number =>
  Math.round((Math.max(-HALF_PI, Math.min(HALF_PI, pitch)) / HALF_PI) * 32767);
export const pitchFromWire = (wire: number): number => (wire / 32767) * HALF_PI;
export const quantisePitch = (pitch: number): number => pitchFromWire(pitchToWire(pitch));

export const LAG_STEP_MS = 5;
export const quantiseLag = (ms: number): number =>
  Math.max(0, Math.min(255, Math.round(ms / LAG_STEP_MS))) * LAG_STEP_MS;
