import {
  Button,
  DEFAULT_COMBAT_SETTINGS,
  DEFAULT_MOVEMENT_SETTINGS,
  Flag,
  PROTOCOL_VERSION,
  SIM_DT,
  SeededRng,
  aimDirection,
  aimOrigin,
  bodyHeight,
  createBody,
  encodeServerMessage,
  hasButton,
  resolveShot,
  seedOf,
  stepBody,
  type CombatSettings,
  type EntityState,
  type GameEvent,
  type GameMap,
  type InputCommand,
  type MatchSettings,
  type MovementSettings,
  type ServerMessage,
  type ShotTarget,
  type SnapshotMessage,
  type SpawnPoint,
} from '@heist/shared';
import { LagCompensator } from './LagCompensator';
import { Player, type PlayerConnection } from './Player';
import { FarthestSpawnPolicy, type SpawnPolicy } from './SpawnPolicy';

export const CLOSE_PROTOCOL = 4000;
export const CLOSE_FULL = 4001;
export const CLOSE_IDLE = 4002;

export type JoinResult =
  | { readonly ok: true; readonly player: Player }
  | { readonly ok: false; readonly code: number; readonly reason: string };

export interface MatchDeps {
  readonly map: GameMap;
  readonly settings: MatchSettings;
  readonly movement?: MovementSettings;
  readonly combat?: CombatSettings;
  /** Seeds bullet spread so a match is reproducible in tests. */
  readonly seed?: string;
  readonly spawnPolicy?: SpawnPolicy;
  /** Wall-clock ms (idle timeouts only; the simulation runs on ticks). */
  readonly now?: () => number;
}

const MAX_ID = 0xffff;

/**
 * One running match: who is in it and what happens each tick. It knows
 * nothing about WebSockets — connections come in as `PlayerConnection`.
 */
export class Match {
  readonly players = new Map<number, Player>();
  tick = 0;
  /** Everything the server has tried to send, for `/metrics` and the load tests. */
  readonly traffic = { bytes: 0, snapshots: 0, events: 0 };
  private nextId = 1;
  private readonly spawnPolicy: SpawnPolicy;
  private readonly now: () => number;
  private readonly movement: MovementSettings;
  private readonly combat: CombatSettings;
  private readonly lagComp: LagCompensator;

  constructor(private readonly deps: MatchDeps) {
    this.movement = deps.movement ?? DEFAULT_MOVEMENT_SETTINGS;
    this.combat = deps.combat ?? DEFAULT_COMBAT_SETTINGS;
    // A bit more history than the rewind cap, so the oldest legal rewind is always covered.
    this.lagComp = new LagCompensator(
      Math.ceil((this.combat.maxLagCompMs / 1000) * deps.settings.tickRate) + 4,
    );
    this.spawnPolicy = deps.spawnPolicy ?? new FarthestSpawnPolicy();
    this.now = deps.now ?? Date.now;
  }

  get map(): GameMap {
    return this.deps.map;
  }

  get settings(): MatchSettings {
    return this.deps.settings;
  }

  join(protocol: number, rawName: string, connection: PlayerConnection): JoinResult {
    if (protocol !== PROTOCOL_VERSION) {
      return { ok: false, code: CLOSE_PROTOCOL, reason: 'Client is out of date, reload the page' };
    }
    if (this.players.size >= this.deps.settings.maxPlayers) {
      return { ok: false, code: CLOSE_FULL, reason: 'Match is full' };
    }
    const id = this.allocateId();
    const spawn = this.spawnPolicy.pick(
      this.deps.map,
      [...this.players.values()].map((p) => p.body),
    );
    const player = new Player(
      id,
      cleanName(rawName, id),
      connection,
      spawn,
      this.now(),
      this.combat.maxHp,
      this.combat.sandboxWeapon,
    );
    player.protectedUntilTick = this.tick + this.ticksFor(this.combat.spawnProtectionSec);
    this.players.set(id, player);

    this.sendTo(player, {
      t: 'welcome',
      playerId: id,
      tick: this.tick,
      tickRate: this.deps.settings.tickRate,
      mapId: this.deps.map.id,
    });
    // Tell the newcomer who is already here, and everyone else about the newcomer.
    for (const other of this.players.values()) {
      if (other.id === id) continue;
      this.sendTo(player, { t: 'event', event: { e: 'joined', id: other.id, name: other.name } });
    }
    this.broadcast({ e: 'joined', id, name: player.name }, id);
    return { ok: true, player };
  }

  /** Adds a stationary target (sandbox only). It has no connection and is never idle-dropped. */
  addDummy(name: string, spot: SpawnPoint): Player {
    const quiet: PlayerConnection = { send: () => {}, close: () => {} };
    const player = new Player(
      this.allocateId(),
      name,
      quiet,
      spot,
      this.now(),
      this.combat.maxHp,
      this.combat.sandboxWeapon,
    );
    player.isDummy = true;
    player.home = spot;
    this.players.set(player.id, player);
    this.broadcast({ e: 'joined', id: player.id, name }, player.id);
    return player;
  }

  leave(id: number): void {
    if (!this.players.delete(id)) return;
    this.lagComp.forget(id);
    this.broadcast({ e: 'left', id });
  }

  /** Called with decoded input; applied on the next tick. */
  receiveInput(id: number, commands: readonly InputCommand[]): void {
    const player = this.players.get(id);
    if (!player) return;
    player.lastHeardAt = this.now();
    player.enqueue(commands, this.deps.settings.inputQueueLimit);
  }

  /** Marks the client as alive without carrying game data (ping, keep-alives). */
  touch(id: number): void {
    const player = this.players.get(id);
    if (player) player.lastHeardAt = this.now();
  }

  /** One authoritative step: simulate, then send each player their view. */
  step(): void {
    this.tick++;
    this.dropIdlePlayers();
    this.respawnDue();
    for (const player of this.players.values()) this.applyInput(player);
    this.recordHistory();
    this.sendSnapshots();
  }

  /**
   * Applies at most `maxCommandsPerTick` queued commands, in order, with the
   * same movement step the client predicts with. The cap is the speed-hack
   * guard: a client cannot move further by sending more commands than time allows.
   */
  private applyInput(player: Player): void {
    if (!player.alive) {
      // Nothing is simulated while dead, but acknowledge what arrived so the client stops replaying it.
      const newest = player.queue.at(-1);
      if (newest) player.lastAppliedSeq = newest.seq;
      player.queue.length = 0;
      return;
    }
    const budget = Math.min(this.deps.settings.maxCommandsPerTick, player.queue.length);
    for (let i = 0; i < budget; i++) {
      const command = player.queue.shift();
      if (!command) break;
      stepBody(player.body, command, SIM_DT, this.deps.map, this.movement);
      player.yaw = command.yaw;
      player.pitch = command.pitch;
      player.lastAppliedSeq = command.seq;
      player.cooldown = Math.max(0, player.cooldown - SIM_DT);
      // Tolerance: eight 1/60 s steps must exactly cover a 450 rpm cooldown despite float error.
      if (hasButton(command.buttons, Button.Fire) && player.cooldown <= 1e-9) {
        this.fire(player, command);
      }
    }
  }

  /**
   * Hitscan: each pellet is a ray from the shooter's aim origin. The server
   * decides everything (what is hit, damage, kills); the client only sends
   * where it was aiming.
   */
  private fire(shooter: Player, command: InputCommand): void {
    const weapon = this.combat.weapons[shooter.weaponId];
    if (!weapon) return;
    shooter.cooldown += 60 / weapon.rpm;

    const origin = aimOrigin(shooter.body, command.yaw, this.movement);
    const targets = this.targetsFor(shooter, command);
    const rng = new SeededRng(
      seedOf(this.deps.seed ?? 'match', this.tick, shooter.id, command.seq),
    );

    for (let pellet = 0; pellet < weapon.pellets; pellet++) {
      // Random point in a cone: uniform over the disc, so spread is not biased to the centre.
      const radius = weapon.spread * Math.sqrt(rng.next());
      const angle = rng.next() * Math.PI * 2;
      const dir = aimDirection(
        command.yaw + (radius * Math.cos(angle)) / Math.max(0.2, Math.cos(command.pitch)),
        command.pitch + radius * Math.sin(angle),
      );
      const result = resolveShot(this.deps.map, origin, dir, weapon.range, targets, this.combat);
      this.broadcast({
        e: 'shot',
        shooter: shooter.id,
        endX: result.end.x,
        endY: result.end.y,
        endZ: result.end.z,
        hit: result.hit,
        target: result.target,
      });
      if (result.hit === 'miss') continue;
      const victim = this.players.get(result.target);
      if (!victim) continue;
      const damage = weapon.damage * (result.hit === 'head' ? this.combat.headshotMultiplier : 1);
      this.damage(victim, damage, shooter);
    }
  }

  /**
   * Who a shot can hit, and where they were *as the shooter saw them*: rewound
   * by the lag the client reports, capped so a lying client can reach back at
   * most `maxLagCompMs`. Only completed ticks are used, so every target is
   * judged at the same moment regardless of processing order within a tick.
   */
  private targetsFor(shooter: Player, command: InputCommand): ShotTarget[] {
    const lagMs = Math.min(command.viewLagMs, this.combat.maxLagCompMs);
    const rewindTick = this.tick - (lagMs / 1000) * this.deps.settings.tickRate;
    const targets: ShotTarget[] = [];
    for (const p of this.players.values()) {
      if (p === shooter || !p.alive || this.isProtected(p)) continue;
      const pose = this.lagComp.poseAt(p.id, rewindTick) ?? {
        x: p.body.x,
        y: p.body.y,
        z: p.body.z,
        height: bodyHeight(p.body, this.movement),
      };
      targets.push({ id: p.id, ...pose });
    }
    return targets;
  }

  private recordHistory(): void {
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      this.lagComp.record(this.tick, p.id, {
        x: p.body.x,
        y: p.body.y,
        z: p.body.z,
        height: bodyHeight(p.body, this.movement),
      });
    }
  }

  private damage(victim: Player, amount: number, attacker: Player): void {
    if (!victim.alive || this.isProtected(victim)) return;
    victim.hp = Math.max(0, victim.hp - Math.round(amount));
    if (victim.hp > 0) return;
    victim.alive = false;
    victim.deaths++;
    attacker.kills++;
    victim.respawnAtTick = this.tick + this.ticksFor(this.combat.respawnDelaySec);
    this.broadcast({ e: 'kill', killer: attacker.id, victim: victim.id });
  }

  private respawnDue(): void {
    for (const p of this.players.values()) {
      if (p.alive || this.tick < p.respawnAtTick) continue;
      const spawn =
        p.home ??
        this.spawnPolicy.pick(
          this.deps.map,
          [...this.players.values()].filter((o) => o !== p && o.alive).map((o) => o.body),
        );
      this.lagComp.forget(p.id);
      Object.assign(p.body, createBody(spawn.x, 0, spawn.z));
      p.yaw = spawn.yaw;
      p.hp = this.combat.respawnHp;
      p.alive = true;
      p.cooldown = 0;
      // Dummies are targets: protection would only get in the way of testing.
      p.protectedUntilTick = p.isDummy
        ? 0
        : this.tick + this.ticksFor(this.combat.spawnProtectionSec);
    }
  }

  private isProtected(player: Player): boolean {
    return this.tick < player.protectedUntilTick;
  }

  private ticksFor(seconds: number): number {
    return Math.round(seconds * this.deps.settings.tickRate);
  }

  private dropIdlePlayers(): void {
    const cutoff = this.now() - this.deps.settings.idleTimeoutMs;
    for (const player of [...this.players.values()]) {
      if (!player.isDummy && player.lastHeardAt < cutoff) {
        player.connection.close(CLOSE_IDLE, 'Timed out');
        this.leave(player.id);
      }
    }
  }

  private sendSnapshots(): void {
    const entities: EntityState[] = [];
    for (const p of this.players.values()) entities.push(entityOf(p, this.isProtected(p)));
    for (const player of this.players.values()) {
      if (player.isDummy) continue; // nobody is listening
      const others = entities.filter((e) => e.id !== player.id);
      const b = player.body;
      const snapshot: SnapshotMessage = {
        t: 'snapshot',
        tick: this.tick,
        ackSeq: player.lastAppliedSeq,
        self: {
          x: b.x,
          y: b.y,
          z: b.z,
          vx: b.vx,
          vy: b.vy,
          vz: b.vz,
          flags: flagsOf(player, this.isProtected(player)),
          hp: player.hp,
        },
        entities: others,
      };
      this.sendTo(player, snapshot);
    }
  }

  private broadcast(event: GameEvent, exceptId?: number): void {
    const bytes = encodeServerMessage({ t: 'event', event });
    for (const p of this.players.values()) {
      if (p.id === exceptId) continue;
      p.connection.send(bytes);
      this.traffic.bytes += bytes.length;
      this.traffic.events++;
    }
  }

  private sendTo(player: Player, message: ServerMessage): void {
    const bytes = encodeServerMessage(message);
    player.connection.send(bytes);
    this.traffic.bytes += bytes.length;
    if (message.t === 'snapshot') this.traffic.snapshots++;
    else this.traffic.events++;
  }

  private allocateId(): number {
    for (let i = 0; i < MAX_ID; i++) {
      const id = this.nextId;
      this.nextId = this.nextId >= MAX_ID ? 1 : this.nextId + 1;
      if (!this.players.has(id)) return id;
    }
    throw new Error('no free player ids');
  }
}

export function flagsOf(player: Player, isProtected = false): number {
  let flags = 0;
  if (isProtected) flags |= Flag.Protected;
  if (player.body.crouching) flags |= Flag.Crouching;
  if (player.body.onGround) flags |= Flag.OnGround;
  if (player.alive) flags |= Flag.Alive;
  return flags;
}

function entityOf(p: Player, isProtected: boolean): EntityState {
  return {
    id: p.id,
    x: p.body.x,
    y: p.body.y,
    z: p.body.z,
    yaw: p.yaw,
    pitch: p.pitch,
    flags: flagsOf(p, isProtected),
    hp: p.hp,
  };
}

/** Printable, trimmed, never empty. Names are shown to other players, so no control characters. */
function cleanName(raw: string, id: number): string {
  const cleaned = [...raw]
    .filter((ch) => ch >= ' ' && ch !== '\u007f')
    .join('')
    .trim()
    .slice(0, 20);
  return cleaned.length > 0 ? cleaned : `Player ${id}`;
}
