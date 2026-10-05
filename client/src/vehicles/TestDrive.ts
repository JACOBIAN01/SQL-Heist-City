import {
  createVehicle,
  stepVehicle,
  type DriveControls,
  type GameMap,
  type VehicleSpec,
  type VehicleState,
} from '@heist/shared';
import type { CarModel } from './CarModel';

/**
 * A car driven locally by the shared physics, drawn smoothly between fixed
 * steps. Phase 8.7's way to try driving (`?drive`); 8.8 makes the server own
 * the car and other players see it.
 */
export class TestDrive {
  readonly state: VehicleState;
  private readonly previous: VehicleState;
  private drawn = { x: 0, z: 0 };

  constructor(
    readonly model: CarModel,
    private readonly map: GameMap,
    private readonly spec: VehicleSpec,
    x: number,
    z: number,
    yaw: number,
  ) {
    this.state = createVehicle(x, z, yaw);
    this.previous = { ...this.state };
    this.drawn = { x, z };
  }

  /** One fixed simulation step. */
  step(controls: DriveControls, dt: number): void {
    Object.assign(this.previous, this.state);
    stepVehicle(this.state, controls, dt, this.map, this.spec);
  }

  /** Draws the car `alpha` of the way from the last step to the current one; returns where. */
  draw(alpha: number): VehicleState {
    const a = this.previous;
    const b = this.state;
    const at = {
      x: a.x + (b.x - a.x) * alpha,
      z: a.z + (b.z - a.z) * alpha,
      yaw: a.yaw + (b.yaw - a.yaw) * alpha,
      steer: a.steer + (b.steer - a.steer) * alpha,
      speed: b.speed,
    };
    const moved = Math.hypot(at.x - this.drawn.x, at.z - this.drawn.z) * Math.sign(b.speed);
    this.drawn = { x: at.x, z: at.z };
    this.model.pose(at, moved);
    return at;
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
