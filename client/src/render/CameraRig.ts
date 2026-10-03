import type { PerspectiveCamera } from 'three';
import { raycastMap, type GameMap } from '@heist/shared';

export interface CameraRigOptions {
  /** How far behind the shoulder the camera sits (m). */
  readonly distance?: number;
  /** Sideways offset so the player is not hiding the crosshair (m, + = right). */
  readonly shoulder?: number;
  /** Where on the body the camera orbits, from the feet (m). */
  readonly pivotHeight?: number;
}

/** Keeps the camera this far from a wall so it never clips into it. */
const WALL_MARGIN = 0.25;
const MIN_DISTANCE = 0.7;

/**
 * Over-the-shoulder camera. Pattern: Strategy (CameraMode, frontend.md) — Why:
 * on-foot, vehicle and spectator cameras differ only in where they sit, so each
 * mode can be its own small class behind the same `update` call.
 */
export class CameraRig {
  private readonly distance: number;
  private readonly shoulder: number;
  private readonly pivotHeight: number;
  private current: number;

  constructor(
    private readonly camera: PerspectiveCamera,
    private readonly map: GameMap,
    options: CameraRigOptions = {},
  ) {
    this.distance = options.distance ?? 3.6;
    this.shoulder = options.shoulder ?? 0.55;
    this.pivotHeight = options.pivotHeight ?? 1.55;
    this.current = this.distance;
  }

  /** `standing` is false while crouched so the camera drops with the head. */
  update(
    x: number,
    y: number,
    z: number,
    yaw: number,
    pitch: number,
    dtSeconds: number,
    crouching = false,
  ): void {
    const height = crouching ? this.pivotHeight * 0.65 : this.pivotHeight;
    const cosP = Math.cos(pitch);
    // Look direction (yaw 0 faces −z, counter-clockwise positive; + pitch looks up).
    const dx = -Math.sin(yaw) * cosP;
    const dy = Math.sin(pitch);
    const dz = -Math.cos(yaw) * cosP;
    // Right of the look direction, flat on the ground.
    const rx = Math.cos(yaw);
    const rz = -Math.sin(yaw);

    const px = x + rx * this.shoulder;
    const py = y + height;
    const pz = z + rz * this.shoulder;

    // Pull in when something is behind us; ease back out so it does not pop.
    const hit = raycastMap(this.map, px, py, pz, -dx, -dy, -dz, this.distance + WALL_MARGIN);
    const wanted = hit === undefined ? this.distance : Math.max(MIN_DISTANCE, hit - WALL_MARGIN);
    this.current = wanted < this.current ? wanted : Math.min(wanted, this.current + dtSeconds * 8);

    this.camera.position.set(
      px - dx * this.current,
      Math.max(0.15, py - dy * this.current),
      pz - dz * this.current,
    );
    this.camera.rotation.set(pitch, yaw, 0, 'YXZ');
  }
}
