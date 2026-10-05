import { Flag, seqNewer, type InputCommand, type SelfState } from '@heist/shared';
import type { LocalPlayer } from './LocalPlayer';

/** A correction bigger than this (m) is a teleport (respawn, hard desync): snap, do not glide. */
const SNAP_DISTANCE = 1.5;
/** Corrections below this (m) are float rounding from the wire, not disagreement. */
const NOISE = 1e-3;
/** The visible error fades with this time constant (s). */
const SMOOTHING_SECONDS = 0.1;
/** Commands kept for replay; far more than ~1 s of input means the connection is dead anyway. */
const MAX_PENDING = 180;

/**
 * Client-side prediction with server reconciliation.
 *
 * The player moves instantly from local input (predict). When the server says
 * "after your command N you were here", we rewind to that state and replay the
 * commands it has not seen yet (reconcile). Because client and server run the
 * identical movement step, the replay lands where we already were — nothing
 * visibly changes. Only a real disagreement (e.g. being pushed, a respawn)
 * produces a correction, and the *drawn* position glides to it instead of
 * snapping, so there is no rubber-banding.
 */
export class PredictedPlayer {
  private pending: InputCommand[] = [];
  private offset = { x: 0, y: 0, z: 0 };
  /** Size of the most recent correction in metres, for the debug overlay. */
  lastCorrection = 0;

  constructor(readonly player: LocalPlayer) {}

  get pendingCount(): number {
    return this.pending.length;
  }

  /** Move now and remember the command until the server confirms it. */
  predict(command: InputCommand): void {
    this.player.apply(command);
    this.pending.push(command);
    if (this.pending.length > MAX_PENDING) this.pending.shift();
  }

  /**
   * Take the server's state as it is, with nothing to replay: while driving the
   * body only rides in the car, and the car is what is predicted.
   */
  follow(server: SelfState): void {
    this.pending = [];
    this.offset = { x: 0, y: 0, z: 0 };
    this.lastCorrection = 0;
    this.player.loadState({
      x: server.x,
      y: server.y,
      z: server.z,
      vx: server.vx,
      vy: server.vy,
      vz: server.vz,
      onGround: (server.flags & Flag.OnGround) !== 0,
      crouching: (server.flags & Flag.Crouching) !== 0,
    });
  }

  /** Commands to send that the server has not acknowledged yet are exactly `pending`. */
  reconcile(server: SelfState, ackSeq: number): void {
    const body = this.player.body;
    const before = { x: body.x, y: body.y, z: body.z };

    this.pending = this.pending.filter((c) => seqNewer(c.seq, ackSeq));
    this.player.loadState({
      x: server.x,
      y: server.y,
      z: server.z,
      vx: server.vx,
      vy: server.vy,
      vz: server.vz,
      onGround: (server.flags & Flag.OnGround) !== 0,
      crouching: (server.flags & Flag.Crouching) !== 0,
    });
    for (const command of this.pending) this.player.apply(command);

    const ex = before.x - body.x;
    const ey = before.y - body.y;
    const ez = before.z - body.z;
    const error = Math.hypot(ex, ey, ez);
    this.lastCorrection = error;
    if (error < NOISE) return;
    if (error > SNAP_DISTANCE) {
      this.offset = { x: 0, y: 0, z: 0 };
      return;
    }
    // Keep what is drawn where it was; the offset then fades to zero.
    this.offset.x += ex;
    this.offset.y += ey;
    this.offset.z += ez;
  }

  /** Call once per frame to fade out any visible correction. */
  smooth(dtSeconds: number): void {
    const keep = Math.exp(-dtSeconds / SMOOTHING_SECONDS);
    this.offset.x *= keep;
    this.offset.y *= keep;
    this.offset.z *= keep;
    if (Math.hypot(this.offset.x, this.offset.y, this.offset.z) < 1e-4) {
      this.offset = { x: 0, y: 0, z: 0 };
    }
  }

  drawPosition(alpha: number, out: { x: number; y: number; z: number }): void {
    this.player.drawPosition(alpha, out);
    out.x += this.offset.x;
    out.y += this.offset.y;
    out.z += this.offset.z;
  }
}
