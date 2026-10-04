import {
  SIM_DT,
  copyBody,
  createBody,
  stepBody,
  type BodyState,
  type GameMap,
  type InputCommand,
  type MovementSettings,
  type SpawnPoint,
} from '@heist/shared';

/**
 * The player this browser controls. Runs the shared movement step locally so
 * controls respond instantly; Phase 5.8 adds server reconciliation on top.
 * Keeps the previous tick's position so drawing can blend between ticks.
 */
export class LocalPlayer {
  readonly body: BodyState;
  private readonly previous: BodyState;
  /** Top-speed multiplier the server told us (cash carried slows you). */
  speedScale = 1;

  constructor(
    private map: GameMap,
    private readonly settings: MovementSettings,
    spawn: SpawnPoint,
  ) {
    this.body = createBody(spawn.x, 0, spawn.z);
    this.previous = createBody(spawn.x, 0, spawn.z);
  }

  /** Swaps the collision map (a vault door opened or closed). */
  setMap(map: GameMap): void {
    this.map = map;
  }

  apply(command: InputCommand): void {
    copyBody(this.body, this.previous);
    stepBody(this.body, command, SIM_DT, this.map, this.settings, this.speedScale);
  }

  /** Where to draw, `alpha` (0..1) of the way from the last tick to this one. */
  drawPosition(alpha: number, out: { x: number; y: number; z: number }): void {
    out.x = this.previous.x + (this.body.x - this.previous.x) * alpha;
    out.y = this.previous.y + (this.body.y - this.previous.y) * alpha;
    out.z = this.previous.z + (this.body.z - this.previous.z) * alpha;
  }

  /** Overwrites physical state, e.g. from a server snapshot. Keeps the blend start in sync. */
  loadState(state: Partial<BodyState>): void {
    Object.assign(this.body, state);
    copyBody(this.body, this.previous);
  }

  teleport(x: number, y: number, z: number): void {
    for (const b of [this.body, this.previous]) {
      b.x = x;
      b.y = y;
      b.z = z;
      b.vx = b.vy = b.vz = 0;
    }
  }
}
