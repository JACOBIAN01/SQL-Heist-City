import { Button, axisToByte, quantiseYaw, type InputCommand, type Rng } from '@heist/shared';

/** What a bot wants this tick; the driver adds the sequence number. */
export type BotIntent = Omit<InputCommand, 'seq'>;

/**
 * Pattern: Strategy — Why: load tests need different crowd behaviours
 * (everyone wandering, everyone fighting) without changing the harness.
 */
export interface BotBrain {
  next(): BotIntent;
}

export interface WanderOptions {
  /** Chance per tick of holding fire (0 = peaceful). */
  readonly fireRate?: number;
  readonly sprintRate?: number;
}

/** Walks in drifting curves, sprints and jumps now and then, optionally shoots. Deterministic per seed. */
export class WanderBrain implements BotBrain {
  private yaw: number;
  private turn = 0;
  private holdTicks = 0;
  private sprinting = false;
  private firing = false;

  constructor(
    private readonly rng: Rng,
    private readonly options: WanderOptions = {},
  ) {
    this.yaw = rng.next() * Math.PI * 2;
  }

  next(): BotIntent {
    if (this.holdTicks <= 0) {
      // Pick a new manoeuvre every 0.3–1.5 s of simulated input.
      this.holdTicks = this.rng.int(20, 90);
      this.turn = (this.rng.next() - 0.5) * 0.08;
      this.sprinting = this.rng.bool(this.options.sprintRate ?? 0.3);
      this.firing = this.rng.bool(this.options.fireRate ?? 0);
    }
    this.holdTicks--;
    this.yaw += this.turn;
    let buttons = 0;
    if (this.sprinting) buttons |= Button.Sprint;
    if (this.rng.bool(0.004)) buttons |= Button.Jump;
    if (this.firing) buttons |= Button.Fire;
    return {
      moveX: 0,
      moveY: axisToByte(1),
      yaw: quantiseYaw(this.yaw),
      pitch: 0,
      buttons,
      viewLagMs: 100,
    };
  }
}
