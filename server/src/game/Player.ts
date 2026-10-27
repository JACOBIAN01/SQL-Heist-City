import type { SentInfo } from './InterestManager';
import {
  SnapshotEncoder,
  createBody,
  seqNewer,
  type BodyState,
  type InputCommand,
  type SpawnPoint,
  type SquadRole,
  weaponToWire,
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
  /** The squad this player plays in (Phase 27), 0 for none. */
  squad = 0;
  /** A bank guard (Phase 29.3): a computer-driven target that shoots back. */
  isGuard = false;
  /** A police officer (Phase 29.4): a guard-like gunman that comes and goes with someone's wanted level. */
  isPolice = false;
  /** Somebody being escorted on a contract (Phase 31.2). */
  isVip = false;
  /** The gun a guard carries (kept across rounds). */
  guardWeapon = '';
  /** The floor level this player starts and respawns at (a guard upstairs), 0 for the street. */
  homeY = 0;
  /** The squad role this player took (Phase 27.3), if any. */
  role: SquadRole | null = null;
  readonly body: BodyState;
  yaw = 0;
  pitch = 0;
  hp: number;
  alive = true;
  /** Weapon held (key into the combat settings); empty when unarmed. */
  weaponId = '';
  /** `weaponId` as the wire index (0 = none), kept so snapshots do not look it up per tick. */
  weaponWire = 0;
  /** Guns owned this life and the rounds left in each magazine. */
  readonly arsenal = new Map<string, number>();
  /** The Phase 5 sandbox rifle never runs dry. */
  infiniteAmmo = false;
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
  /** The car this player drives, 0 on foot. */
  vehicleId = 0;
  /** Cars this client has been told about (so cars leaving its range can be removed). */
  readonly knownVehicles = new Set<number>();
  /** The signed-in account behind this player; none for bots, dummies and unsigned development play. */
  accountId: number | undefined;
  /** A struggling student's heals are scaled by this (skill-scaled difficulty); 1 = normal. */
  healScale = 1;
  /** Earliest tick this player may use an anchor again. */
  interactReadyTick = 0;
  /** Body armour (Phase 29.6): soaks damage before health, lost on death. */
  armour = 0;
  /** Cash on the player: dropped as a bag on death, banked at a safehouse. */
  cash = 0;
  /** Cash that is safe; what the round is won on. */
  banked = 0;
  /** Top-speed multiplier from the cash carried; kept here so the tick does not recompute it. */
  speedScale = 1;
  /** Place on the scoreboard (1 = leading); 0 until first ranked. */
  rank = 0;
  /** How many players were ranked when `rank` was last sent. */
  rankedOf = 0;
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
    public name: string,
    readonly connection: PlayerConnection,
    spawn: SpawnPoint,
    now: number,
    hp: number,
  ) {
    this.hp = hp;
    this.body = createBody(spawn.x, 0, spawn.z);
    this.yaw = spawn.yaw;
    this.lastHeardAt = now;
  }

  /** Rounds left in the held weapon's magazine. */
  get ammo(): number {
    return this.arsenal.get(this.weaponId) ?? 0;
  }

  /** Takes a gun with a full magazine and holds it. */
  giveWeapon(id: string, magSize: number): void {
    this.arsenal.set(id, magSize);
    this.equip(id);
  }

  /** Holds a gun already owned; false if it is not. */
  equip(id: string): boolean {
    if (!this.arsenal.has(id)) return false;
    this.weaponId = id;
    this.weaponWire = weaponToWire(id);
    return true;
  }

  /** Back to empty hands (death, new life). */
  disarm(): void {
    this.arsenal.clear();
    this.weaponId = '';
    this.weaponWire = 0;
  }

  /**
   * Queues commands, ignoring ones already applied (retransmits) and dropping
   * the oldest when the queue is full so a flood cannot grow memory.
   */
  enqueue(commands: readonly InputCommand[], limit: number): number {
    for (const command of commands) {
      const last = this.queue.length > 0 ? this.queue[this.queue.length - 1] : undefined;
      const newest = last ? last.seq : this.lastAppliedSeq;
      if (!seqNewer(command.seq, newest)) continue;
      this.queue.push(command);
    }
    const over = Math.max(0, this.queue.length - limit);
    if (over > 0) this.queue.splice(0, over);
    return over;
  }
}
