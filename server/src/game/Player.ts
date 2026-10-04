import type { SentInfo } from './InterestManager';
import {
  SnapshotEncoder,
  createBody,
  seqNewer,
  type BodyState,
  type InputCommand,
  type SpawnPoint,
} from '@heist/shared';

/** What the match needs from a client connection; sockets and test fakes both fit. */
export interface PlayerConnection {
  send(bytes: Uint8Array): void;
  close(code: number, reason: string): void;
}

/**
 * Server-side state of one player. The connection is behind an interface
 * (SOLID: D — Why: Match logic never touches a socket, so it is unit-tested
 * with fakes and the transport can change freely).
 */
export class Player {
  /**
   * Unique for this join, never reused (ids are): keys per-player state held elsewhere,
   * such as the SQL challenge service's attempts and rate limits.
   */
  key = '';
  readonly body: BodyState;
  yaw = 0;
  pitch = 0;
  hp: number;
  alive = true;
  /** Weapon held (key into the combat settings). */
  weaponId: string;
  /** Seconds until the weapon can fire again; counts down in simulated time, not wall time. */
  cooldown = 0;
  /** Tick until which the player cannot be hurt. */
  protectedUntilTick = 0;
  /** Tick at which a dead player comes back. */
  respawnAtTick = 0;
  /** Sandbox target: has no client, never moves, respawns at `home`. */
  isDummy = false;
  home: SpawnPoint | undefined;
  /** What this client already knows about other players, so snapshots carry only changes. */
  readonly snapshots = new SnapshotEncoder();
  /** Tick at which each other player was last sent to this client (area-of-interest bookkeeping). */
  readonly lastSent = new Map<number, SentInfo>();
  /** Encoded events waiting to ride along with the next snapshot (one WebSocket send per tick). */
  readonly pendingEvents: Uint8Array[] = [];
  pendingCount = 0;
  /** Marks "already got this shot" while a shot event is delivered. */
  shotStamp = 0;
  /** Earliest tick this player may use an anchor again. */
  interactReadyTick = 0;
  /** Cash on the player: dropped as a bag on death, banked at a safehouse. */
  cash = 0;
  /** Cash that is safe; what the round is won on. */
  banked = 0;
  /** Top-speed multiplier from the cash carried; kept here so the tick does not recompute it. */
  speedScale = 1;
  kills = 0;
  deaths = 0;
  /** Last input sequence number applied; echoed in snapshots so the client can reconcile. */
  lastAppliedSeq = 0;
  /** Commands received but not yet applied, oldest first. */
  readonly queue: InputCommand[] = [];
  /** Wall-clock ms of the last message from this client (for idle timeouts). */
  lastHeardAt: number;

  constructor(
    readonly id: number,
    readonly name: string,
    readonly connection: PlayerConnection,
    spawn: SpawnPoint,
    now: number,
    hp: number,
    weaponId: string,
  ) {
    this.hp = hp;
    this.weaponId = weaponId;
    this.body = createBody(spawn.x, 0, spawn.z);
    this.yaw = spawn.yaw;
    this.lastHeardAt = now;
  }

  /**
   * Queues commands, ignoring ones already applied (retransmits) and dropping
   * the oldest when the queue is full so a flood cannot grow memory.
   */
  enqueue(commands: readonly InputCommand[], limit: number): void {
    for (const command of commands) {
      const last = this.queue.length > 0 ? this.queue[this.queue.length - 1] : undefined;
      const newest = last ? last.seq : this.lastAppliedSeq;
      if (!seqNewer(command.seq, newest)) continue;
      this.queue.push(command);
    }
    if (this.queue.length > limit) this.queue.splice(0, this.queue.length - limit);
  }
}
