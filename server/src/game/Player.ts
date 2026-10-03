import {
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

export const MAX_HP = 100;

/**
 * Server-side state of one player. The connection is behind an interface
 * (SOLID: D — Why: Match logic never touches a socket, so it is unit-tested
 * with fakes and the transport can change freely).
 */
export class Player {
  readonly body: BodyState;
  yaw = 0;
  pitch = 0;
  hp = MAX_HP;
  alive = true;
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
  ) {
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
