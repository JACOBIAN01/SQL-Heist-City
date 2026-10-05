import {
  controlsOf,
  seqNewer,
  SIM_DT,
  stepVehicle,
  type GameMap,
  type InputCommand,
  type VehicleSpec,
  type VehicleState,
  type VehicleWire,
} from '@heist/shared';
import type { CarModel } from './CarModel';

/** A correction bigger than this (m) is a jump (a crash the client did not see): snap. */
const SNAP_DISTANCE = 3;
/** The visible error fades with this time constant (s). */
const SMOOTHING_SECONDS = 0.15;
const MAX_PENDING = 180;

/**
 * The car the local player drives, moved instantly from their input with
 * the shared car physics and corrected by the server: on each snapshot it
 * rewinds to the server's car and replays the commands the server has not
 * applied yet (the same idea as PredictedPlayer). The server's car is
 * quantised exactly as the wire carries it, so an undisturbed replay lands
 * where the car already was.
 */
export class PredictedVehicle {
  readonly state: VehicleState;
  private readonly previous: VehicleState;
  private pending: InputCommand[] = [];
  private offset = { x: 0, z: 0 };
  private drawn: { x: number; z: number };
  lastCorrection = 0;

  constructor(
    readonly id: number,
    readonly model: CarModel,
    private map: GameMap,
    private readonly spec: VehicleSpec,
    server: VehicleWire,
  ) {
    this.state = {
      x: server.x,
      z: server.z,
      yaw: server.yaw,
      speed: server.speed,
      steer: server.steer,
    };
    this.previous = { ...this.state };
    this.drawn = { x: server.x, z: server.z };
  }

  setMap(map: GameMap): void {
    this.map = map;
  }

  /** One fixed step from local input; the command is kept until the server confirms it. */
  predict(command: InputCommand): void {
    Object.assign(this.previous, this.state);
    stepVehicle(this.state, controlsOf(command), SIM_DT, this.map, this.spec);
    this.pending.push(command);
    if (this.pending.length > MAX_PENDING) this.pending.shift();
  }

  /** Rewind to the server's car after command `ackSeq` and replay the rest. */
  reconcile(server: VehicleWire, ackSeq: number): void {
    const before = { x: this.state.x, z: this.state.z };
    this.pending = this.pending.filter((c) => seqNewer(c.seq, ackSeq));
    Object.assign(this.state, {
      x: server.x,
      z: server.z,
      yaw: server.yaw,
      speed: server.speed,
      steer: server.steer,
    });
    for (const c of this.pending)
      stepVehicle(this.state, controlsOf(c), SIM_DT, this.map, this.spec);
    const ex = before.x - this.state.x;
    const ez = before.z - this.state.z;
    const error = Math.hypot(ex, ez);
    this.lastCorrection = error;
    if (error > SNAP_DISTANCE) this.offset = { x: 0, z: 0 };
    else {
      // Draw where we were, and let the difference fade out.
      this.offset.x += ex;
      this.offset.z += ez;
    }
    Object.assign(this.previous, this.state);
  }

  /** Draws the car `alpha` of the way between the last two steps, plus any fading correction. */
  draw(alpha: number, dtSeconds: number): VehicleState {
    const keep = Math.exp(-dtSeconds / SMOOTHING_SECONDS);
    this.offset.x *= keep;
    this.offset.z *= keep;
    const a = this.previous;
    const b = this.state;
    const at: VehicleState = {
      x: a.x + (b.x - a.x) * alpha + this.offset.x,
      z: a.z + (b.z - a.z) * alpha + this.offset.z,
      yaw: a.yaw + Math.atan2(Math.sin(b.yaw - a.yaw), Math.cos(b.yaw - a.yaw)) * alpha,
      steer: a.steer + (b.steer - a.steer) * alpha,
      speed: b.speed,
    };
    const moved = Math.hypot(at.x - this.drawn.x, at.z - this.drawn.z) * Math.sign(b.speed);
    this.drawn = { x: at.x, z: at.z };
    this.model.pose(at, moved, true);
    return at;
  }

  get pendingCount(): number {
    return this.pending.length;
  }
}

/**
 * Turns `from` toward `to` (radians) by the shorter way round, closing the gap
 * at `rate` per second (exponentially, so it never overshoots). For the chase camera.
 */
export function followAngle(from: number, to: number, dt: number, rate: number): number {
  const gap = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  return from + gap * (1 - Math.exp(-rate * dt));
}
